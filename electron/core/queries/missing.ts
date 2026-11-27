// Files a scan no longer found on disk (#277). The scan only marks them
// (deleted_at), so a file that comes back keeps its id, its collections and its
// thumbnail; nothing removes them on its own, because only the user knows
// whether a file is gone for good or only away for now (in the trash, or moved
// out to be brought back). These list them and remove the ones the user picks.
import type { DB } from "../db.js";
import type { MissingFileRow } from "../types.js";
import { FILE_COLS } from "./files.js";

/** Gone, and neither removed from the index by the user (those rows are the
 *  exclusion list, which must survive the file being away) nor hidden by a
 *  scan exclusion (not gone, only left out). Written as in
 *  idx_files_missing_list, which the list names: workspace databases are
 *  never ANALYZEd, and without statistics the planner takes
 *  idx_files_excluded, reading every row and sorting. */
const MISSING =
  "f.deleted_at IS NOT NULL AND f.excluded_at IS NULL AND f.scan_excluded_at IS NULL";

/** The most recently gone files first, at most `limit` of them. */
export function listMissingFiles(db: DB, limit: number): MissingFileRow[] {
  return db
    .prepare(
      `SELECT ${FILE_COLS}, f.deleted_at AS deletedAt
       FROM files f INDEXED BY idx_files_missing_list
       LEFT JOIN file_meta m ON m.meta_key = f.meta_key
       WHERE ${MISSING}
       ORDER BY f.deleted_at DESC, f.id DESC
       LIMIT ?`,
    )
    .all(limit) as MissingFileRow[];
}

export function countMissingFiles(db: DB): number {
  return db
    .prepare(`SELECT count(*) FROM files f WHERE ${MISSING}`)
    .pluck()
    .get() as number;
}

/**
 * Delete the rows (and FTS rows) of the given files that are still missing,
 * and return their ids for the caller to remove their thumbnails and
 * collection entries. A file that came back since it was listed is left
 * alone. Metadata keyed by meta_key (tags, ratings, history) is shared with
 * other files and workspaces and stays, as everywhere else.
 */
export function purgeMissingFiles(db: DB, ids: readonly number[]): number[] {
  if (ids.length === 0) return [];
  return db.transaction(() => {
    const gone = db
      .prepare(
        `SELECT f.id FROM files f
         WHERE f.id IN (SELECT value FROM json_each(?)) AND ${MISSING}`,
      )
      .pluck()
      .all(JSON.stringify(ids)) as number[];
    const json = JSON.stringify(gone);
    db.prepare(
      "DELETE FROM files_fts WHERE rowid IN (SELECT value FROM json_each(?))",
    ).run(json);
    db.prepare(
      "DELETE FROM files WHERE id IN (SELECT value FROM json_each(?))",
    ).run(json);
    return gone;
  })();
}
