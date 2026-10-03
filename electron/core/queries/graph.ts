// Rows for the graph view: the files a search matches, in the search's order,
// capped in one query rather than paged (the graph has no infinite scroll).
import type { DB } from "../db.js";
import {
  appendSearchConditions,
  FILE_COLS,
  FILE_FROM,
  orderByFor,
} from "./files.js";
import type { FileRow, SearchQuery } from "../types.js";

/** A file row as the graph needs it: the usual columns plus the meta_key the
 *  node key is built from and tags are joined on. */
export type GraphFileRow = FileRow & { metaKey: string };

/** The graph never pages and never scopes to a folder (the folder view is off
 *  while the graph shows), so those parts of a query are dropped here. */
function graphQuery(query: SearchQuery): SearchQuery {
  return { ...query, cursor: undefined, limit: undefined, folder: undefined };
}

/**
 * The matching files in the query's order, read as the caller consumes them:
 * it stops once it has what it needs, so a query matching far more rows than
 * the graph draws (identical copies, a large collection) is not read whole.
 * `limit`, when the caller knows it, also lets SQLite keep only that many rows
 * in a sort no index serves.
 */
export function* graphFiles(
  db: DB,
  query: SearchQuery,
  limit?: number,
): Generator<GraphFileRow, void, undefined> {
  const q = graphQuery(query);
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS}, f.meta_key AS metaKey ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, q);
  sql += ` ORDER BY ${orderByFor(q.sort, q.sortDir)}`;
  if (limit != null) {
    sql += " LIMIT ?";
    args.push(limit);
  }
  yield* db.prepare(sql).iterate(...args) as IterableIterator<GraphFileRow>;
}

/** Plays recorded for each of `metaKeys` (play_history rows), by meta_key;
 *  files never played are absent. */
export function graphPlayCounts(
  db: DB,
  metaKeys: string[],
): Map<string, number> {
  if (metaKeys.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT meta_key AS metaKey, COUNT(*) AS plays FROM play_history
        WHERE meta_key IN (SELECT value FROM json_each(?))
        GROUP BY meta_key`,
    )
    .all(JSON.stringify(metaKeys)) as { metaKey: string; plays: number }[];
  return new Map(rows.map((r) => [r.metaKey, r.plays]));
}

/** How many files the query matches before any cap: `rows` in all, `nodes`
 *  once identical copies (one meta_key) count as one, as the graph draws them. */
export function graphFileCount(
  db: DB,
  query: SearchQuery,
): { rows: number; nodes: number } {
  const args: unknown[] = [];
  let sql = `SELECT COUNT(*) AS rows, COUNT(DISTINCT f.meta_key) AS nodes ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, graphQuery(query));
  return db.prepare(sql).get(...args) as { rows: number; nodes: number };
}
