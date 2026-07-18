// File search, listing and detail queries. Dynamic SQL is built safely with placeholders.
import type { DB } from "../db.js";
import { fileTags } from "../tags.js";
import { listBookmarksByMetaKey } from "./bookmarks.js";
import { thumbOffsetByKey } from "./meta.js";
import { resolveSortDir } from "../../../shared/sortDir.js";
import type {
  FileDetail,
  FileRow,
  PlayEntry,
  SearchQuery,
  SearchResult,
  TagInfo,
} from "../types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Metadata (rating/favorite/last_accessed) lives in file_meta, keyed by meta_key, so it
// is reached through a LEFT JOIN. COALESCE supplies defaults for files with no meta row.
// Exported for queries that join files under the same `f`/`m` aliases (see history.ts).
export const FILE_COLS =
  "f.id, f.rel_path AS relPath, f.kind, f.ext, f.size, f.width, f.height, f.duration, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite, f.thumb_status AS thumbStatus, f.captured_at AS capturedAt, m.last_accessed_at AS lastAccessedAt";

export const FILE_FROM =
  "FROM files f LEFT JOIN file_meta m ON m.meta_key = f.meta_key";

function buildFtsMatch(q: string): string | null {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return tokens.length ? tokens.join(" ") : null;
}

function appendSearchConditions(
  sql: string,
  args: unknown[],
  query: SearchQuery,
): string {
  const fts = query.q ? buildFtsMatch(query.q) : null;
  if (fts) {
    sql += " AND f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)";
    args.push(fts);
  }
  if (query.kind) {
    sql += " AND f.kind = ?";
    args.push(query.kind);
  }
  if (query.fileIds?.length) {
    // Pass the IDs as a single JSON array bound to one placeholder rather than
    // one placeholder per ID. A large collection would otherwise blow past
    // SQLite's SQLITE_MAX_VARIABLE_NUMBER limit and throw "too many SQL variables".
    sql += " AND f.id IN (SELECT value FROM json_each(?))";
    args.push(JSON.stringify(query.fileIds));
  }
  if (query.ratingMin != null) {
    sql += " AND COALESCE(m.rating, 0) >= ?";
    args.push(query.ratingMin);
  }
  if (query.favorite) {
    sql += " AND m.favorite = 1";
  }
  if (query.capturedFrom != null) {
    sql += " AND f.captured_at >= ?";
    args.push(query.capturedFrom);
  }
  if (query.capturedTo != null) {
    sql += " AND f.captured_at <= ?";
    args.push(query.capturedTo);
  }
  for (const tag of (query.tags ?? []).filter(Boolean)) {
    sql +=
      " AND EXISTS (SELECT 1 FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.meta_key = f.meta_key AND t.name = ?";
    args.push(tag);
    if (query.tagSource) {
      sql += " AND mt.source = ?";
      args.push(query.tagSource);
    }
    sql += ")";
  }
  if (query.played != null) {
    const op = query.played ? "EXISTS" : "NOT EXISTS";
    sql += ` AND ${op} (SELECT 1 FROM play_history ph WHERE ph.meta_key = f.meta_key`;
    if (query.playedVia) {
      sql += " AND ph.via = ?";
      args.push(query.playedVia);
    }
    sql += ")";
  }
  return sql;
}

export function searchFiles(db: DB, query: SearchQuery): SearchResult {
  const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(sql, args, query);

  const order = orderByFor(query.sort, query.sortDir);
  sql += ` ORDER BY ${order}`;

  const offset = Math.max(0, query.cursor ?? 0);
  sql += " LIMIT ? OFFSET ?";
  args.push(limit + 1, offset);

  const items = db.prepare(sql).all(...args) as FileRow[];
  let nextCursor: number | null = null;
  if (items.length > limit) {
    items.length = limit;
    nextCursor = offset + limit;
  }
  attachTags(db, items);
  return { items, nextCursor };
}

function orderByFor(sort?: string, dir?: string): string {
  const direction = resolveSortDir(sort, dir).toUpperCase();
  switch (sort) {
    case "rating":
      return `COALESCE(m.rating, 0) ${direction}, f.id ASC`;
    case "captured":
      return `f.captured_at IS NULL ASC, f.captured_at ${direction}, f.id ASC`;
    case "name":
      return `f.rel_path ${direction}, f.id ASC`;
    case "accessed":
      return `m.last_accessed_at IS NULL ASC, m.last_accessed_at ${direction}, f.id ASC`;
    default:
      return `f.id ${direction}`;
  }
}

/** Pick random files (discovery queue). Uniform random over files matching the query filters. */
export function randomFiles(db: DB, query: SearchQuery): FileRow[] {
  const lim = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? 20));
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(sql, args, query);
  sql += " ORDER BY RANDOM() LIMIT ?";
  args.push(lim);
  const items = db.prepare(sql).all(...args) as FileRow[];
  attachTags(db, items);
  return items;
}

/** Attach tags to a set of files in a single query (for grid display, avoids N+1). */
function attachTags(db: DB, items: FileRow[]): void {
  if (items.length === 0) return;
  const ph = items.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT f.id AS fileId, t.id, t.name, t.namespace, mt.source, mt.score
       FROM files f JOIN meta_tags mt ON mt.meta_key = f.meta_key JOIN tags t ON t.id = mt.tag_id
       WHERE f.id IN (${ph})
       ORDER BY mt.source, t.name`,
    )
    .all(...items.map((i) => i.id)) as {
    fileId: number;
    id: number;
    name: string;
    namespace: string;
    source: string;
    score: number | null;
  }[];
  const byId = new Map<number, TagInfo[]>();
  for (const r of rows) {
    let arr = byId.get(r.fileId);
    if (!arr) {
      arr = [];
      byId.set(r.fileId, arr);
    }
    arr.push({
      id: r.id,
      name: r.name,
      namespace: r.namespace,
      source: r.source,
      score: r.score,
    });
  }
  for (const it of items) it.tags = byId.get(it.id) ?? [];
}

export function filesByIds(db: DB, ids: number[]): FileRow[] {
  const stmt = db.prepare(
    `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.id = ? AND f.deleted_at IS NULL`,
  );
  const out: FileRow[] = [];
  for (const id of ids) {
    const r = stmt.get(id) as FileRow | undefined;
    if (r) out.push(r);
  }
  return out;
}

interface FileDetailRow extends FileRow {
  absPath: string;
  codec: string | null;
  fps: number | null;
  mtime: number;
  meta: string | null;
  metaKey: string;
}

export function fileDetail(db: DB, fileId: number): FileDetail | null {
  const r = db
    .prepare(
      `SELECT ${FILE_COLS}, f.abs_path AS absPath, f.codec, f.fps, f.mtime, f.meta, f.meta_key AS metaKey
       ${FILE_FROM} WHERE f.id = ? AND f.deleted_at IS NULL`,
    )
    .get(fileId) as FileDetailRow | undefined;
  if (!r) return null;
  let meta: unknown = null;
  try {
    meta = r.meta ? JSON.parse(r.meta) : null;
  } catch {
    meta = null;
  }
  const playHistory = db
    .prepare(
      "SELECT played_at AS playedAt, position, via FROM play_history WHERE meta_key = ? ORDER BY played_at DESC LIMIT 50",
    )
    .all(r.metaKey) as PlayEntry[];
  const bookmarks = listBookmarksByMetaKey(db, r.metaKey);
  return {
    ...(r as FileRow),
    absPath: r.absPath,
    codec: r.codec,
    fps: r.fps,
    mtime: r.mtime,
    meta,
    tags: fileTags(db, fileId),
    playHistory,
    bookmarks,
    thumbOffsetSec: thumbOffsetByKey(db, r.metaKey),
  };
}
