// The library shared by every workspace (`<userData>/library.sqlite`, attached
// as `lib`; schema in LIB_DDL, db.ts): moving a workspace's own metadata into it.
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
  usesOwnMetadata,
  type DB,
} from "./db.js";
import { scopedLog } from "./logger.js";
import { BOOKMARK_NEAR_EPS } from "./queries/bookmarks.js";
import { FILE_META_MERGE_SET } from "./queries/meta.js";

const log = scopedLog("library");

/** A workspace's own metadata tables, in drop order: tags last, after the
 *  meta_tags rows that reference it. */
const OWN_METADATA_TABLES = [...META_KEYED_TABLES, "tags"] as const;

/**
 * Merge this workspace's own metadata into the library and drop its tables.
 * Versionless and safe to run on every open (Principle III):
 *
 * 1. No own `file_meta`: nothing to do (merged before, or created after the
 *    library existed).
 * 2. Not recorded in `lib.migrated_workspaces`: copy the whole database to
 *    `backupPath` (VACUUM INTO), then merge and record it in one transaction.
 *    If the copy cannot be written, stop here and keep the own tables.
 * 3. Drop the own tables and rebuild files_fts from the library's tags, in one
 *    transaction. When step 2 was skipped because the workspace was recorded
 *    already, the own tables are merged again first: they may be the ones an
 *    older version of the app recreated and wrote to after the merge.
 *
 * The two transactions write different files, so a crash can fall between
 * them; the record makes the next open skip the backup. The merge rules leave
 * the library unchanged when the same rows are merged again.
 *
 * A failure in either transaction is logged and leaves the workspace on its
 * own tables, as a failed backup does; the next open tries again.
 */
export function migrateWorkspaceMetadata(
  db: DB,
  workspaceId: string,
  backupPath: string,
): void {
  if (!usesOwnMetadata(db)) return;

  const recorded =
    db
      .prepare("SELECT 1 FROM lib.migrated_workspaces WHERE workspace_id = ?")
      .get(workspaceId) !== undefined;
  try {
    if (!recorded) {
      if (!writeBackup(db, backupPath)) return;
      db.transaction(() => {
        mergeIntoLibrary(db);
        db.prepare(
          "INSERT INTO lib.migrated_workspaces (workspace_id, migrated_at) VALUES (?, ?)",
        ).run(workspaceId, nowUnix());
      })();
    }

    db.transaction(() => {
      if (recorded) mergeIntoLibrary(db);
      for (const table of OWN_METADATA_TABLES) {
        db.exec(`DROP TABLE IF EXISTS main.${table}`);
      }
      // tags_text now comes from the library, which may carry tags other
      // workspaces gave the same content.
      rebuildFtsAll(db);
    })();
  } catch (e) {
    log.warn(
      `could not merge the metadata of workspace ${workspaceId}; keeping its own tables for now:`,
      e,
    );
    return;
  }
  log.info(`merged the metadata of workspace ${workspaceId} into the library`);
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
    "SELECT 1 FROM lib.scene_bookmarks WHERE meta_key = ? AND sec BETWEEN ? AND ? LIMIT 1",
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
    const taken = near.get(
      b.meta_key,
      b.sec - BOOKMARK_NEAR_EPS,
      b.sec + BOOKMARK_NEAR_EPS,
    );
    if (taken) continue;
    insert.run(b.meta_key, b.sec, b.created_at);
  }
}
