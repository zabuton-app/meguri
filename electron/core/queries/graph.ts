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
 * Up to `cap` matching files in the query's order. `cap + 1` rows are read so
 * the caller can tell a cut list from one that fits exactly; the extra row is
 * left for the caller to drop (multi-workspace merges need it to compare).
 */
export function graphFiles(
  db: DB,
  query: SearchQuery,
  cap: number,
): GraphFileRow[] {
  const q = graphQuery(query);
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS}, f.meta_key AS metaKey ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, q);
  sql += ` ORDER BY ${orderByFor(q.sort, q.sortDir)} LIMIT ?`;
  args.push(cap + 1);
  return db.prepare(sql).all(...args) as GraphFileRow[];
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
