// Play-history timeline queries. Unlike the per-file history in fileDetail(), these
// list events across the whole workspace, newest first, with pagination.
import type { DB } from "../db.js";
import { FILE_COLS } from "./files.js";
import type { HistoryEntryRow, HistoryQuery, HistoryPage } from "../types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * List play events newest-first, collapsing consecutive runs of the same file into
 * one row (re-plays while watching a video would otherwise flood the timeline).
 * The collapse happens in SQL (window LAG) so LIMIT/OFFSET paginate the collapsed
 * rows, keeping the cursor contract identical to searchFiles.
 */
export function listPlayHistory(db: DB, query: HistoryQuery): HistoryPage {
  const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, query.cursor ?? 0);
  const args: unknown[] = [];
  let viaFilter = "";
  if (query.via) {
    viaFilter = "WHERE ph.via = ?";
    args.push(query.via);
  }
  // f.id = MIN(id) picks one representative file when several rows share a meta_key
  // (duplicate content), preventing row multiplication from the JOIN. History rows
  // whose file is soft-deleted (or gone) drop out naturally via the INNER JOIN.
  const sql = `
    WITH ev AS (
      SELECT ph.id, ph.meta_key, ph.played_at, ph.via, ph.position,
             LAG(ph.meta_key) OVER (ORDER BY ph.played_at DESC, ph.id DESC) AS prev_key
      FROM play_history ph
      ${viaFilter}
    )
    SELECT ${FILE_COLS},
           e.id AS historyId, e.played_at AS playedAt, e.via, e.position,
           (SELECT COUNT(*) FROM play_history p WHERE p.meta_key = e.meta_key) AS playCount
    FROM ev e
    JOIN files f ON f.meta_key = e.meta_key AND f.deleted_at IS NULL
    LEFT JOIN file_meta m ON m.meta_key = f.meta_key
    WHERE (e.prev_key IS NULL OR e.prev_key <> e.meta_key)
      AND f.id = (SELECT MIN(f2.id) FROM files f2
                  WHERE f2.meta_key = e.meta_key AND f2.deleted_at IS NULL)
    ORDER BY e.played_at DESC, e.id DESC
    LIMIT ? OFFSET ?`;
  args.push(limit + 1, offset);

  const items = db.prepare(sql).all(...args) as HistoryEntryRow[];
  let nextCursor: number | null = null;
  if (items.length > limit) {
    items.length = limit;
    nextCursor = offset + limit;
  }
  return { items, nextCursor };
}

/** Delete every play event in this workspace. */
export function clearPlayHistory(db: DB): void {
  db.prepare("DELETE FROM play_history").run();
}
