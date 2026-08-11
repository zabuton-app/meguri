// File search, listing and detail queries. Dynamic SQL is built safely with placeholders.
import type { DB } from "../db.js";
import { fileTags } from "../tags.js";
import { listBookmarksByMetaKey } from "./bookmarks.js";
import { thumbOffsetByKey } from "./meta.js";
import { resolveSortDir } from "../../../shared/sortDir.js";
import {
  LIST_HIDDEN_SOURCES,
  parseMetaSearchToken,
  parseTagSearchToken,
  splitSearchTokens,
} from "../../../shared/tags.js";
import type {
  FileDetail,
  FileRow,
  PlayEntry,
  SearchQuery,
  SearchResult,
  TagInfo,
} from "../types.js";

const DEFAULT_LIMIT = 100;

/** Bound once: the excluded-source list never changes at runtime. */
const HIDDEN_SOURCES_JSON = JSON.stringify([...LIST_HIDDEN_SOURCES]);
const MAX_LIMIT = 500;

// Metadata (rating/favorite/last_accessed) lives in file_meta, keyed by meta_key, so it
// is reached through a LEFT JOIN. COALESCE supplies defaults for files with no meta row.
// Exported for queries that join files under the same `f`/`m` aliases (see history.ts).
export const FILE_COLS =
  "f.id, f.rel_path AS relPath, f.kind, f.ext, f.size, f.width, f.height, f.duration, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite, f.thumb_status AS thumbStatus, f.content_hash AS contentHash, f.captured_at AS capturedAt, f.btime, m.last_accessed_at AS lastAccessedAt";

export const FILE_FROM =
  "FROM files f LEFT JOIN file_meta m ON m.meta_key = f.meta_key";

// Same transform as listTagNames (tags.ts): escape LIKE metacharacters so user
// input matches literally, paired with an ESCAPE '\' clause.
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Split the free-text query for the trigram-tokenized files_fts.
 *
 *  A `meta:<value>` token is pulled out first: generated tags are not in the
 *  full-text index (see FTS_ROW_SELECT in db.ts), so this prefix is the explicit
 *  way to reach them from the search box.
 *
 *  Of what remains, tokens of 3+ codepoints go into an FTS MATCH expression
 *  (trigram matches substrings, so no prefix `*` is needed). Shorter tokens
 *  cannot produce a trigram and would make the whole MATCH return zero rows, so
 *  they are routed to LIKE filters against the same files_fts columns instead
 *  (codepoint count, not UTF-16 length, since the trigram tokenizer works on
 *  codepoints). Double quotes are stripped before the length split: a pasted
 *  `"beach"` means the word beach, not a literal quoted string — searching for
 *  the quote characters would return zero rows. */
function buildSearchTerms(q: string): {
  match: string | null;
  likeTokens: string[];
  metaTokens: string[];
  tagTokens: string[];
} {
  const tokens = splitSearchTokens(q);
  const matchTokens: string[] = [];
  const likeTokens: string[] = [];
  const metaTokens: string[] = [];
  const tagTokens: string[] = [];
  for (const t of tokens) {
    const meta = parseMetaSearchToken(t);
    const tag = parseTagSearchToken(t);
    if (meta) {
      metaTokens.push(meta);
    } else if (tag) {
      tagTokens.push(tag);
    } else if ([...t].length >= 3) {
      // FTS5 phrase syntax: the token is delimited by quotes, so a quote inside
      // it has to be doubled or the whole MATCH expression is malformed.
      matchTokens.push(`"${t.replace(/"/g, '""')}"`);
    } else {
      likeTokens.push(t);
    }
  }
  return {
    match: matchTokens.length ? matchTokens.join(" ") : null,
    likeTokens,
    metaTokens,
    tagTokens,
  };
}

/**
 * Resolve one qualified tag token ("beach", "res:4k") to the tag ids that satisfy
 * it in THIS database.
 *
 * Matching is driven by the `tags` table rather than by parsing the token against
 * a hardcoded namespace list, so any namespace present in the data is filterable
 * without touching this code, and a manual tag literally named "todo:later" still
 * matches itself. The concatenation is evaluated over `tags` only — a small table
 * — once per token while the query is built, never per candidate row.
 */
function resolveTagIds(db: DB, token: string): number[] {
  const rows = token.includes(":")
    ? db
        .prepare(
          `SELECT id FROM tags
            WHERE (namespace = '' AND name = ?)
               OR (namespace <> '' AND namespace || ':' || name = ?)`,
        )
        .pluck()
        .all(token, token)
    : db
        .prepare("SELECT id FROM tags WHERE namespace = '' AND name = ?")
        .pluck()
        .all(token);
  return rows as number[];
}

/**
 * Resolve a `meta:` search value to the pipeline-owned tag ids it names. Accepts
 * either the bare value (`4k`, `long`, `hevc`) or the qualified form
 * (`res:4k`), so a user can type whichever they saw.
 *
 * Matched case-insensitively: this value is typed into the search box, where the
 * FTS half is case-insensitive too — `meta:4K` failing while `4K` works would be
 * an arbitrary split. Structured `tags[]` tokens stay exact; those come from a
 * chip click or a saved search, never from typing.
 */
function resolveManualTagIds(db: DB, value: string): number[] {
  return db
    .prepare(
      "SELECT id FROM tags WHERE namespace = '' AND name = ? COLLATE NOCASE",
    )
    .pluck()
    .all(value) as number[];
}

function resolvePipelineTagIds(db: DB, value: string): number[] {
  return db
    .prepare(
      `SELECT id FROM tags
        WHERE namespace <> ''
          AND (name = ? COLLATE NOCASE
               OR namespace || ':' || name = ? COLLATE NOCASE)`,
    )
    .pluck()
    .all(value, value) as number[];
}

function appendSearchConditions(
  db: DB,
  sql: string,
  args: unknown[],
  query: SearchQuery,
): string {
  const terms = query.q
    ? buildSearchTerms(query.q)
    : { match: null, likeTokens: [], metaTokens: [], tagTokens: [] };
  if (terms.match) {
    sql += " AND f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)";
    args.push(terms.match);
  }
  for (const tok of terms.likeTokens) {
    // Correlated EXISTS (rowid = f.id) instead of an independent IN-subquery:
    // the latter LIKE-scans the whole files_fts table per token, while this
    // form only probes the rows already narrowed by MATCH and other filters.
    sql +=
      " AND EXISTS (SELECT 1 FROM files_fts x WHERE x.rowid = f.id AND (x.rel_path LIKE ? ESCAPE '\\' OR x.tags_text LIKE ? ESCAPE '\\'))";
    const pattern = `%${escapeLike(tok)}%`;
    args.push(pattern, pattern);
  }
  const directives: [string[], (v: string) => number[]][] = [
    [terms.metaTokens, (v) => resolvePipelineTagIds(db, v)],
    [terms.tagTokens, (v) => resolveManualTagIds(db, v)],
  ];
  for (const [values, resolve] of directives) {
    for (const value of values) {
      const ids = resolve(value);
      if (ids.length === 0) {
        // No tag by that name: nothing can match.
        sql += " AND 0";
        break;
      }
      sql +=
        " AND EXISTS (SELECT 1 FROM meta_tags mt WHERE mt.meta_key = f.meta_key AND mt.tag_id IN (SELECT value FROM json_each(?)))";
      args.push(JSON.stringify(ids));
    }
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
  if (query.btimeFrom != null) {
    sql += " AND f.btime >= ?";
    args.push(query.btimeFrom);
  }
  if (query.btimeTo != null) {
    sql += " AND f.btime <= ?";
    args.push(query.btimeTo);
  }
  for (const tag of (query.tags ?? []).filter(Boolean)) {
    const ids = resolveTagIds(db, tag);
    if (ids.length === 0) {
      // Unknown tag: nothing can carry it, so short-circuit the whole query.
      sql += " AND 0";
      break;
    }
    // Pre-resolving to ids drops the `tags` join, leaving a primary-key probe on
    // meta_tags(meta_key, tag_id).
    sql +=
      " AND EXISTS (SELECT 1 FROM meta_tags mt WHERE mt.meta_key = f.meta_key AND mt.tag_id IN (SELECT value FROM json_each(?))";
    args.push(JSON.stringify(ids));
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

/**
 * Keyset-seek position for one per-DB query: rows must come strictly after the
 * sort position (v, id) in the active order. `tie` encodes how rows that tie
 * on the sort value relate to the cross-workspace tiebreak (this stream's
 * workspaceId vs. the key's): "after-id" = same workspace (skip up to and
 * including the key row), "all" = later workspace (keep every tie), "none" =
 * earlier workspace (ties already emitted).
 */
export interface SeekPosition {
  v: string | number | null;
  id: number;
  tie: "after-id" | "all" | "none";
}

interface SortSpec {
  /** SQL expression of the sort value (matches orderByFor's primary term). */
  expr: string | null;
  /** True when the column can be NULL (NULLs sort last in both directions). */
  nullable: boolean;
  /** SQL comparator moving *forward* in the sort direction. */
  cmp: "<" | ">";
  /** Forward comparator for the id tiebreak (follows direction only for name). */
  idCmp: "<" | ">";
}

function sortSpecFor(sort?: string, dir?: string): SortSpec {
  const desc = resolveSortDir(sort, dir) === "desc";
  const cmp = desc ? "<" : ">";
  switch (sort) {
    case "rating":
      return {
        expr: "COALESCE(m.rating, 0)",
        nullable: false,
        cmp,
        idCmp: ">",
      };
    case "captured":
      return { expr: "f.captured_at", nullable: true, cmp, idCmp: ">" };
    case "btime":
      return { expr: "f.btime", nullable: true, cmp, idCmp: ">" };
    case "name":
      return { expr: "f.rel_path", nullable: false, cmp, idCmp: cmp };
    case "accessed":
      return { expr: "m.last_accessed_at", nullable: true, cmp, idCmp: ">" };
    case "hash":
      // Content-hash order: identical files (duplicates) sort adjacently.
      return { expr: "f.content_hash", nullable: true, cmp, idCmp: ">" };
    default:
      return { expr: null, nullable: false, cmp, idCmp: cmp };
  }
}

/** The seek key's value for a returned row (mirrors sortSpecFor's expressions). */
export function sortValueOf(
  sort: string | undefined,
  row: FileRow,
): string | number | null {
  switch (sort) {
    case "rating":
      return row.rating;
    case "captured":
      return row.capturedAt;
    case "btime":
      return row.btime;
    case "name":
      return row.relPath;
    case "accessed":
      return row.lastAccessedAt;
    case "hash":
      return row.contentHash ?? null;
    default:
      return null;
  }
}

/** WHERE fragment (with bound args appended) placing the scan just after `seek`. */
function appendSeekCondition(
  args: unknown[],
  seek: SeekPosition,
  sort?: string,
  dir?: string,
): string {
  const { expr, nullable, cmp, idCmp } = sortSpecFor(sort, dir);
  if (!expr) {
    // Default (id) sort: the cross-workspace order is workspaceId first, then
    // id — so a later workspace's rows all follow the key ("all"), an earlier
    // workspace's rows all precede it ("none"), and only the key's own
    // workspace seeks by id.
    if (seek.tie === "all") return "1";
    if (seek.tie === "none") return "0";
    args.push(seek.id);
    return `f.id ${cmp} ?`;
  }
  if (nullable && seek.v == null) {
    // The key sits in the NULLs-last tail: only NULL rows can still follow.
    if (seek.tie === "none") return "0";
    if (seek.tie === "all") return `${expr} IS NULL`;
    args.push(seek.id);
    return `${expr} IS NULL AND f.id ${idCmp} ?`;
  }
  // Non-null key. NULL rows always sort after it, so they stay included for
  // nullable columns; non-null rows compare against the key value.
  const nullTail = nullable ? `${expr} IS NULL OR ` : "";
  if (seek.tie === "none") {
    args.push(seek.v);
    return `${nullTail}${expr} ${cmp} ?`;
  }
  if (seek.tie === "all") {
    args.push(seek.v);
    return `${nullTail}${expr} ${cmp}= ?`;
  }
  args.push(seek.v, seek.v, seek.id);
  return `${nullTail}${expr} ${cmp} ? OR (${expr} = ? AND f.id ${idCmp} ?)`;
}

/**
 * Search one workspace DB. With `seek`, the page starts right after that sort
 * position (keyset pagination — no OFFSET scan) and `nextCursor` is null: the
 * caller (crossWorkspace) tracks continuation itself. Without it, the legacy
 * numeric-offset contract applies. `skipTags` defers tag attachment to the
 * caller (the k-way merge discards rows, so batch-level attachment is wasted).
 */
export function searchFiles(
  db: DB,
  query: SearchQuery,
  seek?: SeekPosition,
  opts?: { skipTags?: boolean },
): SearchResult {
  // The seek path allows one extra row (internal callers fetch limit+1 for
  // has-more detection); the IPC boundary still caps requests at MAX_LIMIT.
  const cap = seek ? MAX_LIMIT + 1 : MAX_LIMIT;
  const limit = Math.max(1, Math.min(cap, query.limit ?? DEFAULT_LIMIT));
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, query);
  if (seek) {
    const seekArgs: unknown[] = [];
    sql += ` AND (${appendSeekCondition(seekArgs, seek, query.sort, query.sortDir)})`;
    args.push(...seekArgs);
  }

  const order = orderByFor(query.sort, query.sortDir);
  sql += ` ORDER BY ${order}`;

  let nextCursor: number | null = null;
  let items: FileRow[];
  if (seek) {
    sql += " LIMIT ?";
    args.push(limit);
    items = db.prepare(sql).all(...args) as FileRow[];
  } else {
    const offset = numericCursor(query.cursor);
    sql += " LIMIT ? OFFSET ?";
    args.push(limit + 1, offset);
    items = db.prepare(sql).all(...args) as FileRow[];
    if (items.length > limit) {
      items.length = limit;
      nextCursor = offset + limit;
    }
  }
  if (!opts?.skipTags) attachTags(db, items);
  return { items, nextCursor };
}

/** Offset of a legacy cursor (object cursors resolve through their offset). */
export function numericCursor(cursor: SearchQuery["cursor"]): number {
  if (cursor == null) return 0;
  return Math.max(0, typeof cursor === "number" ? cursor : cursor.offset);
}

/**
 * ORDER BY clause for a sort key/direction. Exported for the index-plan tests.
 * Kept in lockstep with comparatorFor() in crossWorkspace.ts — the All view's
 * k-way merge re-implements this ordering in JS and breaks if they diverge.
 */
export function orderByFor(sort?: string, dir?: string): string {
  const direction = resolveSortDir(sort, dir).toUpperCase();
  switch (sort) {
    case "rating":
      return `COALESCE(m.rating, 0) ${direction}, f.id ASC`;
    case "captured":
      return `f.captured_at IS NULL ASC, f.captured_at ${direction}, f.id ASC`;
    case "btime":
      return `f.btime IS NULL ASC, f.btime ${direction}, f.id ASC`;
    case "name":
      // The id tiebreak follows the main direction so both directions map onto
      // a single scan of idx_files_alive_rel_path (forward/backward); a fixed
      // "id ASC" would force a temp b-tree for the DESC case.
      return `f.rel_path ${direction}, f.id ${direction}`;
    case "accessed":
      return `m.last_accessed_at IS NULL ASC, m.last_accessed_at ${direction}, f.id ASC`;
    case "hash":
      return `f.content_hash IS NULL ASC, f.content_hash ${direction}, f.id ASC`;
    default:
      return `f.id ${direction}`;
  }
}

/**
 * Pick random files (discovery queue). Uniform random over files matching the
 * query filters. Instead of "ORDER BY RANDOM() LIMIT n" (which assigns a random
 * to every matching row and sorts them all, O(N log N) on wide rows), stream
 * the matching ids through a size-`lim` reservoir (Algorithm R) — memory stays
 * O(lim) rather than one array entry per matching row — and materialize only
 * the sampled rows via primary-key lookups.
 */
export function randomFiles(db: DB, query: SearchQuery): FileRow[] {
  const lim = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? 20));
  const args: unknown[] = [];
  let sql = `SELECT f.id ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, query);

  const reservoir: number[] = [];
  let seen = 0;
  for (const id of db
    .prepare(sql)
    .pluck()
    .iterate(...args)) {
    if (seen < lim) {
      reservoir.push(id as number);
    } else {
      const j = Math.floor(Math.random() * (seen + 1));
      if (j < lim) reservoir[j] = id as number;
    }
    seen++;
  }
  // The reservoir is a uniform sample, but its internal order is biased
  // (early rows tend to stay near the front) — shuffle before presenting.
  for (let i = reservoir.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [reservoir[i], reservoir[j]] = [reservoir[j], reservoir[i]];
  }
  const items = filesByIds(db, reservoir);
  attachTags(db, items);
  return items;
}

/** Attach tags to a set of files in a single query (for grid display, avoids N+1). Exported for the All view's merge, which attaches tags only to the final page. */
/**
 * Attach each row's tags in one query (rather than N+1).
 *
 * Sources in LIST_HIDDEN_SOURCES are left out: a list row never renders them, so
 * shipping four generated tags per file across the process boundary — 100 rows a
 * page — would be paid for nothing. `fileDetail()` still returns the full set,
 * which is where the detail pane reads them from.
 */
export function attachTags(db: DB, items: FileRow[]): void {
  if (items.length === 0) return;
  const ph = items.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT f.id AS fileId, t.id, t.name, t.namespace, mt.source, mt.score
       FROM files f JOIN meta_tags mt ON mt.meta_key = f.meta_key JOIN tags t ON t.id = mt.tag_id
       WHERE f.id IN (${ph})
         AND mt.source NOT IN (SELECT value FROM json_each(?))
       ORDER BY mt.source, t.namespace, t.name`,
    )
    .all(...items.map((i) => i.id), HIDDEN_SOURCES_JSON) as {
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
