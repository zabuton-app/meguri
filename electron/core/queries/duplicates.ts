// Duplicate detection queries. Two files are considered duplicates when their
// (content_hash, size) pair matches — the same criterion the scanner uses for
// move/rename detection (the hash samples head/tail + size, not full content).
import type { DB } from "../db.js";
import type { FileRow } from "../types.js";
import { FILE_COLS, FILE_FROM } from "./files.js";

/** FileRow with the grouping key guaranteed present (rows are hash-filtered). */
export interface DuplicateFileRow extends FileRow {
  contentHash: string;
}

const DUP_KEY_FILTER =
  "deleted_at IS NULL AND content_hash IS NOT NULL AND size IS NOT NULL";

/**
 * All files participating in an intra-DB duplicate group. Rows arrive grouped
 * by (content_hash, size); the caller buckets them into DuplicateGroups.
 */
export function duplicateFiles(db: DB): DuplicateFileRow[] {
  return db
    .prepare(
      `SELECT ${FILE_COLS}
       ${FILE_FROM}
       JOIN (
         SELECT content_hash AS h, size AS s
         FROM files
         WHERE ${DUP_KEY_FILTER}
         GROUP BY content_hash, size
         HAVING COUNT(*) > 1
       ) d ON d.h = f.content_hash AND d.s = f.size
       WHERE f.deleted_at IS NULL
       ORDER BY f.content_hash, f.size, f.id`,
    )
    .all() as DuplicateFileRow[];
}

/**
 * Lightweight (hash, size, count) tuples for cross-workspace aggregation
 * (pass 1). Streamed so the caller can fold rows into a map without
 * materializing the full list.
 */
export function duplicateHashCounts(
  db: DB,
): IterableIterator<{ hash: string; size: number; n: number }> {
  return db
    .prepare(
      `SELECT content_hash AS hash, size, COUNT(*) AS n
       FROM files
       WHERE ${DUP_KEY_FILTER}
       GROUP BY content_hash, size`,
    )
    .iterate() as IterableIterator<{ hash: string; size: number; n: number }>;
}

/** IDs of files in an intra-DB duplicate group (the search-filter counterpart
 *  of duplicateFiles — no row materialization). */
export function duplicateFileIds(db: DB): number[] {
  return db
    .prepare(
      `SELECT f.id
       FROM files f
       JOIN (
         SELECT content_hash AS h, size AS s
         FROM files
         WHERE ${DUP_KEY_FILTER}
         GROUP BY content_hash, size
         HAVING COUNT(*) > 1
       ) d ON d.h = f.content_hash AND d.s = f.size
       WHERE f.deleted_at IS NULL`,
    )
    .pluck()
    .all() as number[];
}

/** (id, hash, size) tuples for the given content hashes — the lightweight
 *  variant of filesByContentHashes for building cross-workspace ref sets. */
export function fileIdsByContentHashes(
  db: DB,
  hashes: string[],
): { id: number; hash: string; size: number }[] {
  if (hashes.length === 0) return [];
  return db
    .prepare(
      `SELECT id, content_hash AS hash, size
       FROM files
       WHERE deleted_at IS NULL AND size IS NOT NULL
         AND content_hash IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(hashes)) as { id: number; hash: string; size: number }[];
}

/**
 * Files matching any of the given content hashes (pass 2). Looked up by hash
 * only (idx_files_content_hash); the caller's (hash, size) bucketing discards
 * same-hash/different-size strays. Hashes bind as one JSON placeholder to stay
 * under SQLITE_MAX_VARIABLE_NUMBER.
 */
export function filesByContentHashes(
  db: DB,
  hashes: string[],
): DuplicateFileRow[] {
  if (hashes.length === 0) return [];
  return db
    .prepare(
      `SELECT ${FILE_COLS}
       ${FILE_FROM}
       WHERE f.deleted_at IS NULL AND f.size IS NOT NULL
         AND f.content_hash IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(hashes)) as DuplicateFileRow[];
}
