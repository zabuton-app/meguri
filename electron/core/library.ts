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
  resyncFtsForKeys,
  usesOwnMetadata,
  type DB,
} from "./db.js";
import { scopedLog } from "./logger.js";
import { BOOKMARK_NEAR_EPS } from "./queries/bookmarks.js";
import { FILE_META_MERGE_SET } from "./queries/meta.js";
import { getSetting, setSetting } from "./queries/settings.js";

const log = scopedLog("library");

/** A workspace's own metadata tables, in drop order: tags last, after the
 *  meta_tags rows that reference it. */
const OWN_METADATA_TABLES = [...META_KEYED_TABLES, "tags"] as const;

/**
 * Merge this workspace's own metadata into the library and drop its tables.
 * Versionless and safe to run on every open (Principle III):
 *
 * 1. No own `file_meta`: nothing to merge (merged before, or created after the
 *    library existed). It is recorded in `lib.migrated_workspaces` if it is not
 *    yet.
 * 2. Not recorded in `lib.migrated_workspaces`: copy the whole database to
 *    `backupPath` (VACUUM INTO), then merge and record it in one transaction.
 *    If the copy cannot be written, stop here and keep the own tables.
 *    When the workspace was recorded already, its own tables are merged again
 *    (no backup, no new record): they may be the ones an older version of the
 *    app recreated and wrote to after the merge.
 * 3. Drop the own tables and rebuild files_fts from the library's tags, in one
 *    transaction, recording the index as current (FTS_TAG_SEQ_KEY).
 *
 * The two transactions write different files, so a crash can fall between
 * them; the record makes the next open skip the backup. The merge rules leave
 * the library unchanged when the same rows are merged again.
 *
 * A failure in either transaction is logged and leaves the workspace on its
 * own tables, as a failed backup does; the next open tries again.
 *
 * Returns whether the merge ran to the end, which changes tags the other
 * workspaces may index.
 */
export function migrateWorkspaceMetadata(
  db: DB,
  workspaceId: string,
  backupPath: string,
): boolean {
  if (!usesOwnMetadata(db)) {
    // Created after the library, or merged before: on the library already.
    // Recorded so a write to every workspace knows it need not be opened to
    // be reached (Workspaces.metadataCores).
    db.prepare(
      "INSERT OR IGNORE INTO lib.migrated_workspaces (workspace_id, migrated_at) VALUES (?, ?)",
    ).run(workspaceId, nowUnix());
    return false;
  }

  const recorded =
    db
      .prepare("SELECT 1 FROM lib.migrated_workspaces WHERE workspace_id = ?")
      .get(workspaceId) !== undefined;
  try {
    if (!recorded && !writeBackup(db, backupPath)) return false;
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
  } catch (e) {
    log.warn(
      `could not merge the metadata of workspace ${workspaceId}; keeping its own tables for now:`,
      e,
    );
    return false;
  }
  log.info(`merged the metadata of workspace ${workspaceId} into the library`);
  return true;
}

/**
 * Copy the workspace database to `backupPath`. A copy left by an attempt that
 * stopped before the merge was recorded is replaced: the merge had not
 * happened, so the database is still in the state it describes.
 */
function writeBackup(db: DB, backupPath: string): boolean {
  try {
    fs.rmSync(backupPath, { force: true });
    db.prepare("VACUUM main INTO ?").run(backupPath);
    return true;
  } catch (e) {
    log.warn(
      `could not back up ${backupPath}; keeping this workspace's own metadata for now:`,
      e,
    );
    return false;
  }
}

/**
 * Merge rules (specs/015-shared-user-metadata/research.md, R5). Each gives the
 * same result when the same rows are merged again. Caller supplies the
 * transaction.
 */
function mergeIntoLibrary(db: DB): void {
  db.exec(`
    INSERT INTO lib.file_meta
      (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
    SELECT meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at
    FROM main.file_meta WHERE true
    ON CONFLICT (meta_key) DO UPDATE SET ${FILE_META_MERGE_SET};
  `);

  // Tags are matched on the exact (namespace, name). Spellings that differ only
  // by case stay separate rows, as #190 left them within one library; search
  // and auto tagging already treat them as one (tagIdentityKey).
  db.exec(`
    INSERT INTO lib.tags (name, namespace)
    SELECT name, namespace FROM main.tags WHERE true
    ON CONFLICT (namespace, name) DO NOTHING;

    INSERT OR IGNORE INTO lib.meta_tags (meta_key, tag_id, source, score)
    SELECT mt.meta_key, lt.id, mt.source, mt.score
    FROM main.meta_tags mt
    JOIN main.tags t ON t.id = mt.tag_id
    JOIN lib.tags lt ON lt.namespace = t.namespace AND lt.name = t.name;
  `);

  // An identical play event (same file, time, position and player) is kept once.
  db.exec(`
    INSERT INTO lib.play_history (meta_key, played_at, position, via)
    SELECT DISTINCT p.meta_key, p.played_at, p.position, p.via
    FROM main.play_history p
    WHERE NOT EXISTS (
      SELECT 1 FROM lib.play_history x
      WHERE x.meta_key = p.meta_key AND x.played_at = p.played_at
        AND x.via = p.via AND x.position IS p.position)
    ORDER BY p.played_at, p.meta_key;
  `);

  // One at a time, so a bookmark is checked against the ones just added too:
  // the same window addBookmark applies to a new one.
  const near = db.prepare(
    "SELECT 1 FROM lib.scene_bookmarks WHERE meta_key = ? AND ABS(sec - ?) <= ? LIMIT 1",
  );
  const insert = db.prepare(
    "INSERT INTO lib.scene_bookmarks (meta_key, sec, created_at) VALUES (?, ?, ?)",
  );
  const rows = db
    .prepare(
      "SELECT meta_key, sec, created_at FROM main.scene_bookmarks ORDER BY meta_key, sec, id",
    )
    .all() as { meta_key: string; sec: number; created_at: number }[];
  for (const b of rows) {
    if (near.get(b.meta_key, b.sec, BOOKMARK_NEAR_EPS)) continue;
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
 * detected; the app never does that itself.
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
    const files = db
      .prepare("SELECT COUNT(*) FROM files WHERE deleted_at IS NULL")
      .pluck()
      .get() as number;
    if (keys.length > files * RESYNC_SHARE_LIMIT) {
      rebuildTagIndex(db);
      return;
    }
    resyncFtsForKeys(db, keys);
    setSetting(db, FTS_TAG_SEQ_KEY, String(latest));
  })();
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
