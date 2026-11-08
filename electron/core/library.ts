// The library shared by every workspace (`<userData>/library.sqlite`, attached
// as `lib`; schema in LIB_DDL, db.ts): moving a workspace's own metadata into
// it, and keeping every workspace's keyword index (files_fts.tags_text) in step
// with the tags it holds (catchUpTagIndex, syncTagIndexes).
//
// Before the library existed every workspace database held its own file_meta,
// tags, meta_tags, scene_bookmarks and play_history. The merge below runs when
// a workspace is opened (Core.init), so a workspace that cannot be opened today
// is merged on the day it can. Until its merge has run, its own tables shadow
// the library's (an unqualified name resolves in `main` first), so it keeps
// working on its own metadata — which is also what happens when the backup
// cannot be written.
import fs from "node:fs";
import {
  META_KEYED_TABLES,
  nowUnix,
  rebuildFtsAll,
  errorCode,
  resyncFtsForKeys,
  usesOwnMetadata,
  type DB,
} from "./db.js";
import { scopedLog } from "./logger.js";
import { BOOKMARK_NEAR_EPS } from "./queries/bookmarks.js";
import { FILE_META_MERGE_SET } from "./queries/meta.js";
import { getSetting, setSetting } from "./queries/settings.js";
import type { LibraryMergeFailureReason } from "../../shared/ipc/schema.js";

const log = scopedLog("library");

/** A workspace's own metadata tables, in drop order: tags last, after the
 *  meta_tags rows that reference it. */
const OWN_METADATA_TABLES = [...META_KEYED_TABLES, "tags"] as const;

export interface MergeOutcome {
  /** The merge ran to the end, which changes tags the others may index. */
  merged: boolean;
  /** Set when the workspace still holds its own tables. */
  failure?: LibraryMergeFailureReason;
}

/** A full disk, as SQLite and the file system report it. */
function isDiskFull(e: unknown): boolean {
  const code = errorCode(e);
  return code === "SQLITE_FULL" || code === "ENOSPC";
}

/**
 * Merge this workspace's own metadata into the library and drop its tables.
 * Versionless and safe to run on every open (Principle III):
 *
 * 1. No own `file_meta`: nothing to merge (merged before, or created after the
 *    library existed). It is recorded in `lib.migrated_workspaces` as complete
 *    if it is not yet.
 * 2. Not recorded in `lib.migrated_workspaces`: copy the whole database to
 *    `backupPath` (VACUUM INTO), then merge and record it in one transaction.
 *    If the copy cannot be written, stop here and keep the own tables.
 *    When the workspace was recorded already, its own tables are merged again
 *    (no backup, no new record): they may be the ones an older version of the
 *    app recreated and wrote to after the merge.
 * 3. Drop the own tables and rebuild files_fts from the library's tags, in one
 *    transaction, recording the index as current (FTS_TAG_SEQ_KEY). Then mark
 *    the record complete.
 * 4. Keep the copy: once the move is complete, the library is the one place
 *    its metadata lives, so the copy goes only when a copy of the library
 *    taken afterwards holds it (Workspaces.dropCoveredBackups).
 *
 * The two transactions write different files, so a crash can fall between
 * them; the record makes the next open skip the backup, and, not complete,
 * keeps the workspace in reach of writes meant for every workspace until the
 * drop has run. The merge rules leave
 * the library unchanged when the same rows are merged again.
 *
 * A failure in either transaction is logged and leaves the workspace on its
 * own tables, as a failed backup does; the next open tries again.
 *
 * Returns a MergeOutcome: `merged` when the merge ran to the end (which
 * changes tags the other workspaces may index), `failure` with the reason when
 * the workspace is still on its own tables.
 */
export function migrateWorkspaceMetadata(
  db: DB,
  workspaceId: string,
  backupPath: string,
): MergeOutcome {
  const record = db
    .prepare(
      "SELECT complete FROM lib.migrated_workspaces WHERE workspace_id = ?",
    )
    .get(workspaceId) as { complete: number } | undefined;
  if (!usesOwnMetadata(db)) {
    // Merged before into a library that no longer has it (one put back from
    // a copy older than the merge, or made anew): its own tables are gone,
    // and its copy is what is left of them. Merged again from there.
    if (record === undefined && fs.existsSync(backupPath)) {
      return mergeFromBackup(db, workspaceId, backupPath);
    }
    // Created after the library, or merged before: on the library already.
    // Recorded complete so a write to every workspace knows it need not be
    // opened to be reached (Workspaces.metadataCores). Written only when it
    // is not yet, so an ordinary open takes no lock on the library.
    if (record?.complete !== 1) markComplete(db, workspaceId);
    return { merged: false };
  }

  const recorded = record !== undefined;
  try {
    if (!recorded) {
      const error = writeBackup(db, backupPath);
      if (error !== null) {
        return {
          merged: false,
          failure: isDiskFull(error) ? "diskFull" : "backup",
        };
      }
    }
    // Library side and workspace side in transactions of their own: in WAL
    // mode a transaction over attached databases is not atomic across the
    // files, so one that wrote both could leave the drop committed and the
    // merge not.
    db.transaction(() => {
      mergeIntoLibrary(db);
      if (!recorded) {
        db.prepare(
          "INSERT INTO lib.migrated_workspaces (workspace_id, migrated_at) VALUES (?, ?)",
        ).run(workspaceId, nowUnix());
      }
    })();

    db.transaction(() => {
      for (const table of OWN_METADATA_TABLES) {
        db.exec(`DROP TABLE IF EXISTS main.${table}`);
      }
      // tags_text now comes from the library, which may carry tags other
      // workspaces gave the same content.
      rebuildTagIndex(db);
    })();
    // Only once the drop has committed: complete with the tables still there
    // would let a write to every workspace skip them.
    markComplete(db, workspaceId);
  } catch (e) {
    log.warn(
      `could not merge the metadata of workspace ${workspaceId}; keeping its own tables for now:`,
      e,
    );
    return { merged: false, failure: isDiskFull(e) ? "diskFull" : "merge" };
  }
  log.info(`merged the metadata of workspace ${workspaceId} into the library`);
  // The copy stays until a copy of the library holds what it guards
  // (Workspaces.dropCoveredBackups).
  return { merged: true };
}

/**
 * Merge the own tables kept in a workspace's copy (writeBackup) into a library
 * that has no record of it, then record it complete. The copy stays: what it
 * holds is in the library again only once a copy of the library is taken
 * (Workspaces.dropCoveredBackups). A failure leaves nothing recorded, so the
 * next open tries again.
 */
function mergeFromBackup(
  db: DB,
  workspaceId: string,
  backupPath: string,
): MergeOutcome {
  try {
    db.prepare("ATTACH DATABASE ? AS kept").run(backupPath);
  } catch (e) {
    log.warn(`could not read the backup ${backupPath}:`, e);
    return { merged: false, failure: "merge" };
  }
  try {
    const holds =
      db
        .prepare(
          "SELECT 1 FROM kept.sqlite_master WHERE type = 'table' AND name = 'file_meta'",
        )
        .get() !== undefined;
    if (!holds) {
      markComplete(db, workspaceId);
      return { merged: false };
    }
    db.transaction(() => {
      mergeIntoLibrary(db, "kept");
      rebuildTagIndex(db);
    })();
  } catch (e) {
    log.warn(
      `could not merge the metadata of workspace ${workspaceId} from its backup:`,
      e,
    );
    return { merged: false, failure: isDiskFull(e) ? "diskFull" : "merge" };
  } finally {
    db.exec("DETACH DATABASE kept");
  }
  markComplete(db, workspaceId);
  log.warn(
    `the library had no record of workspace ${workspaceId}: merged its metadata again from ${backupPath}`,
  );
  return { merged: true };
}

/**
 * Record the workspace as merged with its own tables gone. A failure is
 * logged: the record only spares opening it for a write to every workspace,
 * and the next open writes it again.
 */
function markComplete(db: DB, workspaceId: string): void {
  try {
    db.prepare(
      `INSERT INTO lib.migrated_workspaces (workspace_id, migrated_at, complete)
       VALUES (?, ?, 1)
       ON CONFLICT (workspace_id) DO UPDATE SET complete = 1`,
    ).run(workspaceId, nowUnix());
  } catch (e) {
    log.warn(`could not record workspace ${workspaceId} as merged:`, e);
  }
}

/** Delete a partial copy writeBackup left. A failure is logged: the copy
 *  only costs disk space. */
function removeBackup(backupPath: string): void {
  try {
    fs.rmSync(backupPath, { force: true });
  } catch (e) {
    log.warn(`could not delete the backup ${backupPath}:`, e);
  }
}

/**
 * The workspace ids `migrated_workspaces` records as complete: merged, with
 * their own tables gone. `db` is a library opened on
 * its own (openLibraryReadonly), or `lib` when `schema` says so. Empty when
 * the table cannot be read: then every workspace is opened to find out.
 */
export function recordedWorkspaceIds(
  db: DB,
  schema: "main" | "lib" = "main",
): Set<string> {
  try {
    return new Set(
      db
        .prepare(
          `SELECT workspace_id FROM ${schema}.migrated_workspaces WHERE complete = 1`,
        )
        .pluck()
        .all() as string[],
    );
  } catch {
    return new Set();
  }
}

/**
 * Copy the workspace database to `backupPath`, returning the error when it
 * cannot (null when it could). A copy left by an attempt that
 * stopped before the merge was recorded is replaced: the merge had not
 * happened, so the database is still in the state it describes.
 */
function writeBackup(db: DB, backupPath: string): unknown {
  try {
    fs.rmSync(backupPath, { force: true });
    db.prepare("VACUUM main INTO ?").run(backupPath);
    return null;
  } catch (e) {
    log.warn(
      `could not back up ${backupPath}; keeping this workspace's own metadata for now:`,
      e,
    );
    // A partial copy only takes the space the merge needs.
    removeBackup(backupPath);
    return e;
  }
}

/**
 * Merge rules (specs/015-shared-user-metadata/research.md, R5). Each gives the
 * same result when the same rows are merged again. Caller supplies the
 * transaction.
 */
function mergeIntoLibrary(db: DB, from: "main" | "kept" = "main"): void {
  db.exec(`
    INSERT INTO lib.file_meta
      (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
    SELECT meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at
    FROM ${from}.file_meta WHERE true
    ON CONFLICT (meta_key) DO UPDATE SET ${FILE_META_MERGE_SET};
  `);

  // Tags are matched on the exact (namespace, name). Spellings that differ only
  // by case stay separate rows, as #190 left them within one library; search
  // and auto tagging already treat them as one (tagIdentityKey).
  db.exec(`
    INSERT INTO lib.tags (name, namespace)
    SELECT name, namespace FROM ${from}.tags WHERE true
    ON CONFLICT (namespace, name) DO NOTHING;

    INSERT OR IGNORE INTO lib.meta_tags (meta_key, tag_id, source, score)
    SELECT mt.meta_key, lt.id, mt.source, mt.score
    FROM ${from}.meta_tags mt
    JOIN ${from}.tags t ON t.id = mt.tag_id
    JOIN lib.tags lt ON lt.namespace = t.namespace AND lt.name = t.name;
  `);

  // An identical play event (same file, time, position and player) is kept once.
  db.exec(`
    INSERT INTO lib.play_history (meta_key, played_at, position, via)
    SELECT DISTINCT p.meta_key, p.played_at, p.position, p.via
    FROM ${from}.play_history p
    WHERE NOT EXISTS (
      SELECT 1 FROM lib.play_history x
      WHERE x.meta_key = p.meta_key AND x.played_at = p.played_at
        AND x.via = p.via AND x.position IS p.position)
    ORDER BY p.played_at, p.meta_key;
  `);

  // One at a time, so a bookmark is checked against the ones just added too:
  // the same window addBookmark applies to a new one.
  const near = db.prepare(
    "SELECT 1 FROM lib.scene_bookmarks WHERE meta_key = ? AND sec BETWEEN ? AND ? LIMIT 1",
  );
  const insert = db.prepare(
    "INSERT INTO lib.scene_bookmarks (meta_key, sec, created_at) VALUES (?, ?, ?)",
  );
  const rows = db
    .prepare(
      `SELECT meta_key, sec, created_at FROM ${from}.scene_bookmarks ORDER BY meta_key, sec, id`,
    )
    .all() as { meta_key: string; sec: number; created_at: number }[];
  for (const b of rows) {
    const taken = near.get(
      b.meta_key,
      b.sec - BOOKMARK_NEAR_EPS,
      b.sec + BOOKMARK_NEAR_EPS,
    );
    if (taken) continue;
    insert.run(b.meta_key, b.sec, b.created_at);
  }
}

/**
 * Workspace setting: the last `lib.tag_changes` seq this workspace's
 * files_fts.tags_text reflects. Unset until the index is first built from the
 * library.
 */
export const FTS_TAG_SEQ_KEY = "fts_tag_seq";

/** The last seq `lib.tag_changes` handed out, rows trimmed or not; 0 before the first. */
function latestTagChange(db: DB): number {
  const row = db
    .prepare("SELECT seq FROM lib.sqlite_sequence WHERE name = 'tag_changes'")
    .get() as { seq: number } | undefined;
  return row?.seq ?? 0;
}

/** The FTS_TAG_SEQ_KEY this workspace has recorded, or null if none (or unreadable). */
function tagIndexSeq(db: DB): number | null {
  const stored = getSetting(db, FTS_TAG_SEQ_KEY);
  const seq = stored === null ? NaN : Number(stored);
  return Number.isSafeInteger(seq) ? seq : null;
}

/** Rebuild files_fts and record it as reflecting every tag change so far. Caller supplies the transaction. */
function rebuildTagIndex(db: DB): void {
  rebuildFtsAll(db);
  setSetting(db, FTS_TAG_SEQ_KEY, String(latestTagChange(db)));
}

/**
 * How many of the latest `lib.tag_changes` rows are kept for workspaces that
 * are not open, so one opened later catches up on the keys it missed rather
 * than rebuilding its whole index. A row is a few dozen bytes. A workspace
 * further behind than this rebuilds.
 */
export const TAG_CHANGES_KEPT = 50_000;

/**
 * Past this share of the workspace's files, re-syncing key by key costs more
 * than rebuilding the index (about twice as much once every file has changed).
 */
const RESYNC_SHARE_LIMIT = 0.3;

/**
 * Bring this workspace's files_fts.tags_text up to date with tag changes made
 * through any workspace (research.md, R4), in one transaction:
 *
 * - Already at the latest change: nothing to do.
 * - Never built from the library, ahead of it (the library file was replaced
 *   with one that has handed out fewer seqs), behind the oldest change still
 *   logged (trimmed meanwhile), or behind by more keys than RESYNC_SHARE_LIMIT
 *   of its files: rebuild the whole index.
 * - Otherwise: re-sync only the keys logged since.
 *
 * A library replaced with one that has handed out as many seqs or more is not
 * detected: the copy libraryBackup.ts puts back has its sequence moved far
 * ahead, so it is never the case there.
 *
 * A workspace still on its own metadata tables (its merge has not run) indexes
 * those and is left alone.
 */
export function catchUpTagIndex(db: DB): void {
  if (usesOwnMetadata(db)) return;
  db.transaction(() => {
    const latest = latestTagChange(db);
    const seen = tagIndexSeq(db);
    if (seen === latest) return;
    const { oldest } = db
      .prepare("SELECT MIN(seq) AS oldest FROM lib.tag_changes")
      .get() as { oldest: number | null };
    if (
      seen === null ||
      seen > latest ||
      oldest === null ||
      oldest > seen + 1
    ) {
      rebuildTagIndex(db);
      return;
    }
    // Only the keys of files this workspace holds: most of a large change
    // may be other workspaces' files, which this index has nothing to do with.
    const keys = db
      .prepare(
        `SELECT DISTINCT c.meta_key FROM lib.tag_changes c
          WHERE c.seq > ? AND EXISTS (
            SELECT 1 FROM main.files f INDEXED BY idx_files_meta_key
             WHERE f.meta_key = c.meta_key)`,
      )
      .pluck()
      .all(seen) as string[];
    // Counted only as far as the decision needs: past keys / limit files,
    // re-syncing wins whatever the rest is.
    const files = db
      .prepare(
        "SELECT COUNT(*) FROM (SELECT 1 FROM files WHERE deleted_at IS NULL LIMIT ?)",
      )
      .pluck()
      .get(Math.floor(keys.length / RESYNC_SHARE_LIMIT) + 1) as number;
    if (keys.length > files * RESYNC_SHARE_LIMIT) {
      rebuildTagIndex(db);
      return;
    }
    resyncFtsForKeys(db, keys);
    setSetting(db, FTS_TAG_SEQ_KEY, String(latest));
  })();
}

/**
 * Re-index the files behind `metaKeys` after a tag write that changed them,
 * and record the index as current when those keys are all the log holds past
 * it: the write's own changes, so catchUpTagIndex (syncTagIndexes after every
 * write) does not apply them a second time, which for a large write would
 * mean rebuilding the whole index. Caller supplies the transaction, the one
 * the write ran in.
 */
export function resyncTagIndexForKeys(
  db: DB,
  metaKeys: readonly string[],
): void {
  resyncFtsForKeys(db, [...metaKeys]);
  if (usesOwnMetadata(db)) return;
  const seen = tagIndexSeq(db);
  const latest = latestTagChange(db);
  if (seen === null || seen >= latest) return;
  const { oldest } = db
    .prepare("SELECT MIN(seq) AS oldest FROM lib.tag_changes")
    .get() as { oldest: number | null };
  // Rows the index has not applied are gone from the log: only a rebuild knows.
  if (oldest === null || oldest > seen + 1) return;
  const other = db
    .prepare(
      `SELECT 1 FROM lib.tag_changes WHERE seq > ?
         AND meta_key NOT IN (SELECT value FROM json_each(?)) LIMIT 1`,
    )
    .get(seen, JSON.stringify(metaKeys));
  if (!other) setSetting(db, FTS_TAG_SEQ_KEY, String(latest));
}

/**
 * Catch every given workspace up (catchUpTagIndex), then trim the log: a row
 * goes once each of them has applied it and `kept` newer rows have been logged
 * after it, so a workspace opened later finds what it missed. A failure is
 * logged and does not stop the others; nothing is trimmed then.
 */
export function syncTagIndexes(
  dbs: readonly DB[],
  kept: number = TAG_CHANGES_KEPT,
): void {
  let floor = Infinity;
  let any: DB | undefined;
  for (const db of dbs) {
    try {
      if (usesOwnMetadata(db)) continue;
      catchUpTagIndex(db);
      floor = Math.min(floor, tagIndexSeq(db) ?? 0);
      any = db;
    } catch (e) {
      log.warn("could not bring a workspace's tag index up to date:", e);
      floor = 0;
    }
  }
  if (!any) return;
  try {
    const upTo = Math.min(floor, latestTagChange(any) - kept);
    if (upTo > 0) {
      any.prepare("DELETE FROM lib.tag_changes WHERE seq <= ?").run(upTo);
    }
  } catch (e) {
    log.warn("could not trim the tag change log:", e);
  }
}
