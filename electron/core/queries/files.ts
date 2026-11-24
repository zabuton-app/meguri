// File search, listing and detail queries. Dynamic SQL is built safely with placeholders.
import { naturalNameKey } from "../nameKey.js";
import type { DB } from "../db.js";
import { fileTags } from "../tags.js";
import { listBookmarksByMetaKey } from "./bookmarks.js";
import { thumbOffsetByKey } from "./meta.js";
import { resolveSortDir } from "../../../shared/sortDir.js";
import { TEXT_SUBTITLE_CODECS } from "../../../shared/embeddedSubtitles.js";
import {
  FOLDER_FILE_FROM,
  folderCondition,
  folderRange,
} from "./folderRange.js";
import {
  LIST_HIDDEN_SOURCES,
  parseNegatedSearchToken,
  parseSearchDirective,
  type NumericSearch,
  searchTokenTerms,
  splitSearchTokens,
  BARE_SEARCH_NAMESPACES,
  tagIdentityKey,
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
const TEXT_SUBTITLE_CODECS_JSON = JSON.stringify(TEXT_SUBTITLE_CODECS);
const MAX_LIMIT = 500;

// Metadata (rating/favorite/last_accessed) lives in file_meta, keyed by meta_key, so it
// is reached through a LEFT JOIN. COALESCE supplies defaults for files with no meta row.
// Exported for queries that join files under the same `f`/`m` aliases (see history.ts).
export const FILE_COLS =
  "f.id, f.rel_path AS relPath, f.kind, f.ext, f.size, f.width, f.height, f.duration, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite, f.thumb_status AS thumbStatus, (f.thumb_path IS NOT NULL) AS hasThumb, f.content_hash AS contentHash, f.captured_at AS capturedAt, f.btime, f.created_at AS addedAt, m.last_accessed_at AS lastAccessedAt, m.resume_position AS resumePosition, CASE WHEN m.resume_position IS NOT NULL AND f.duration > 0 THEN MIN(1.0, m.resume_position / f.duration) END AS progress";

export const FILE_FROM =
  "FROM files f LEFT JOIN file_meta m ON m.meta_key = f.meta_key";

// Same transform as listTagNames (tags.ts): escape LIKE metacharacters so user
// input matches literally, paired with an ESCAPE '\' clause.
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** One free-text token: any of its terms, through the index or LIKE. */
interface FreeTextGroup {
  match: string | null;
  likes: string[];
}

/** How the search box's text is read (see appendSearchConditions).
 *
 *  A `tag:<value>` token is a directive: generated tags are not in the
 *  full-text index (see FTS_ROW_SELECT in db.ts), so this prefix is the explicit
 *  way to reach them from the search box. So are `hash:` and `ext:`.
 *
 *  Of what remains, tokens of 3+ codepoints go into an FTS MATCH expression
 *  (trigram matches substrings, so no prefix `*` is needed). Shorter tokens
 *  cannot produce a trigram and would make the whole MATCH return zero rows, so
 *  they are routed to LIKE filters against the same files_fts columns instead
 *  (codepoint count, not UTF-16 length, since the trigram tokenizer works on
 *  codepoints). Double quotes are stripped before the length split: a pasted
 *  `"beach"` means the word beach, not a literal quoted string — searching for
 *  the quote characters would return zero rows.
 *
 *  A token may carry alternatives (`yoga|ヨガ`, see searchTokenTerms), any of
 *  which satisfies it. Each token becomes one group — a plain token is a group
 *  of one — split by whether each term can use the trigram index. */
function freeTextGroup(token: string): FreeTextGroup {
  const words = searchTokenTerms(token);
  const long = words.filter(isTrigramSearchable).map(ftsPhrase);
  return {
    match: long.length ? long.join(" OR ") : null,
    likes: words.filter((term) => !isTrigramSearchable(term)),
  };
}

/**
 * The column each numeric directive compares. Duration in whole seconds, as the
 * list shows it (formatDuration floors), so `duration:1:30` finds a 90.4 s clip.
 */
const NUMERIC_SEARCH_COLUMNS: Record<NumericSearch["field"], string> = {
  size: "f.size",
  duration: "CAST(f.duration AS INTEGER)",
  width: "f.width",
  height: "f.height",
};

/** A term the trigram tokenizer can index: three code points or more. */
function isTrigramSearchable(term: string): boolean {
  return [...term].length >= 3;
}

/**
 * FTS5 phrase syntax: the term is delimited by quotes, so a quote inside it has
 * to be doubled or the whole MATCH expression is malformed. Being a phrase is
 * also what keeps FTS5 operators typed by the user (`OR`, `NEAR`, `*`) literal.
 */
function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
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
 * Resolve a `tag:` search value to every tag id it names — the user's own and
 * the generated ones alike, since one directive covers both. Accepts the bare
 * name (`beach`, `4k`, `long`) or, for a generated tag, the qualified form
 * (`res:4k`), so a user can type whichever they saw.
 *
 * A bare value that names a manual tag *and* a generated one resolves to both,
 * and the condition matches either. That is the reading a person means by
 * "tag:4k"; the qualified form is there when only the generated one is wanted.
 *
 * Matched case-insensitively, by tagIdentityKey (`tag_key` in SQL): this value
 * is typed into the search box, where the FTS half is case-insensitive too —
 * `tag:4K` failing while `4K` works would be an arbitrary split — and every
 * other path calls `Été` and `été` one tag. Structured `tags[]` tokens stay
 * exact; those come from a saved search, never from typing.
 */
function resolveSearchTagIds(db: DB, value: string): number[] {
  const key = tagIdentityKey(value);
  // A bare value names a manual tag or one of the bare-searched generated
  // namespaces' (#468): `tag:jazz` is not every file whose genre is jazz.
  // The one place a namespace list decides identity (docs/data-model.md):
  // a namespace left out still resolves in its qualified form.
  return db
    .prepare(
      `SELECT id FROM tags
        WHERE (tag_key(name) = ?
               AND (namespace = '' OR namespace IN (SELECT value FROM json_each(?))))
           OR (namespace <> '' AND tag_key(namespace || ':' || name) = ?)`,
    )
    .pluck()
    .all(key, JSON.stringify(BARE_SEARCH_NAMESPACES), key) as number[];
}

/**
 * How many meta_tags rows a tag filter may match and still start from them
 * (#365). The count is library-wide: every one of them is a probe of the
 * files' meta_key index, whichever workspace it belongs to, so the cap also
 * bounds what that form costs (about a millisecond on 50,000 files).
 * Exported for the tests, which put a tag on either side of it.
 */
export const RARE_TAG_ROWS = 2000;

/**
 * The condition that a file carries one of the tags in `ids` (a JSON array),
 * optionally from one source. For a rare tag, the list starts from the tag's
 * rows in idx_meta_tags_tag and looks the files up by meta_key. For a common
 * one, it stays a probe of meta_tags per file: collecting every match then
 * costs more than checking each file, and a list sorted along an index stops
 * checking once a page fills.
 *
 * Through files.id rather than `f.meta_key IN (...)`: without statistics, the
 * planner pairs the latter with idx_files_alive and still walks every live
 * file, while an IN on the rowid is the lookup it prefers.
 */
function tagCondition(
  db: DB,
  args: unknown[],
  ids: string,
  source?: string,
): string {
  const rows = db
    .prepare(
      "SELECT count(*) FROM (SELECT 1 FROM meta_tags WHERE tag_id IN (SELECT value FROM json_each(?)) LIMIT ?)",
    )
    .pluck()
    .get(ids, RARE_TAG_ROWS + 1) as number;
  args.push(ids);
  if (source) args.push(source);
  const bySource = source ? " AND mt.source = ?" : "";
  return rows <= RARE_TAG_ROWS
    ? `f.id IN (SELECT id FROM files WHERE meta_key IN (SELECT mt.meta_key FROM meta_tags mt WHERE mt.tag_id IN (SELECT value FROM json_each(?))${bySource}))`
    : `EXISTS (SELECT 1 FROM meta_tags mt WHERE mt.meta_key = f.meta_key AND mt.tag_id IN (SELECT value FROM json_each(?))${bySource})`;
}

/**
 * The FROM clause for a search's rows: inside a folder, that folder's slice of
 * the rel_path index, whatever the query sorts by or picks (see PINNED_FILES).
 * The root has no range to walk. Exported for the index-plan tests.
 */
export function fromFor(query: SearchQuery): string {
  return query.folder?.path ? FOLDER_FILE_FROM : FILE_FROM;
}

/**
 * The condition that a file's path or user tags match one free-text token:
 * any of its terms, through the index or LIKE. Parenthesized, so a leading
 * NOT negates all of it.
 */
function anyOfCondition(group: FreeTextGroup, args: unknown[]): string {
  const parts: string[] = [];
  if (group.match) {
    // The terms the index can serve stay on the index, whatever else is in
    // the group. Besides the cost, MATCH folds case for every script while
    // LIKE only does for ASCII — sending `école` to LIKE because `ヨガ` sat
    // beside it would silently stop it matching `École`.
    parts.push("f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)");
    args.push(group.match);
  }
  if (group.likes.length > 0) {
    // Too short for a trigram (two-character Japanese words are the common
    // case): LIKE, as a correlated EXISTS (rowid = f.id) rather than an
    // independent IN-subquery — the latter LIKE-scans the whole files_fts
    // table per term, while this form only probes the rows already narrowed
    // by MATCH and the other filters.
    const likes = group.likes
      .map(
        () => "x.rel_path LIKE ? ESCAPE '\\' OR x.tags_text LIKE ? ESCAPE '\\'",
      )
      .join(" OR ");
    parts.push(
      `EXISTS (SELECT 1 FROM files_fts x WHERE x.rowid = f.id AND (${likes}))`,
    );
    for (const term of group.likes) {
      const pattern = `%${escapeLike(term)}%`;
      args.push(pattern, pattern);
    }
  }
  return `(${parts.join(" OR ")})`;
}

/**
 * The condition that a file matches one directive token (see
 * parseSearchDirective), or null for free text. A new kind of directive has to
 * be handled here — the switch does not compile without it — and both `x` and
 * `-x` then work: the exclusion only ever wraps this.
 */
function directiveCondition(
  db: DB,
  token: string,
  args: unknown[],
): string | null {
  const d = parseSearchDirective(token);
  if (d === null) return null;
  switch (d.kind) {
    case "hash":
      // A range on the hash rather than LIKE, so idx_files_content_hash serves
      // it: every hex digit sorts before "g", so the prefix followed by "g" is
      // past every hash that starts with it. Files without a hash never match.
      args.push(d.value, `${d.value}g`);
      return "f.content_hash >= ? AND f.content_hash < ?";
    case "ext":
      // Exact, on the lower-cased value the scan stores. No index: with
      // nothing else narrowing, a rare extension makes the list walk its sort
      // order until a page fills, up to every live row.
      args.push(d.value);
      return "f.ext = ?";
    case "numeric":
      // No index either, for the same reason as ext. A NULL value (an image's
      // duration) fails every comparison, so an unknown value never matches,
      // and is kept by `-duration:<30s`. The operator is one of the parser's
      // fixed set, never text from the query.
      args.push(d.num.value);
      return `${NUMERIC_SEARCH_COLUMNS[d.num.field]} ${d.num.op} ?`;
    case "rating":
      // A file without a rating counts as 0, as ratingMin reads it below.
      // The operator comes from the parser's fixed set, never the typed text.
      args.push(d.rating.value);
      return `COALESCE(m.rating, 0) ${d.rating.op} ?`;
    case "favorite":
      // NULL without a file_meta row: kept by `-is:fav`, as a non-favorite.
      return "m.favorite = 1";
    case "tag": {
      const ids = resolveSearchTagIds(db, d.value);
      // No tag by that name: no file carries it.
      return ids.length === 0
        ? "0"
        : tagCondition(db, args, JSON.stringify(ids));
    }
  }
}

/** The condition that a file matches one token, directive or free text. */
function searchTokenCondition(db: DB, token: string, args: unknown[]): string {
  return (
    directiveCondition(db, token, args) ??
    anyOfCondition(freeTextGroup(token), args)
  );
}

/**
 * Append the WHERE conditions a SearchQuery asks for. Exported so the graph
 * view (queries/graph.ts) narrows exactly the rows files_search would.
 */
export function appendSearchConditions(
  db: DB,
  sql: string,
  args: unknown[],
  query: SearchQuery,
  /** rel_path's separator; see folderRange(). Injected only by tests. */
  sep?: string,
): string {
  sql = appendTextConditions(db, sql, args, query.q);
  return appendFilterConditions(db, sql, args, query, sep);
}

/** The conditions of the search box's text (`q`). */
function appendTextConditions(
  db: DB,
  sql: string,
  args: unknown[],
  q: string | undefined,
): string {
  // Plain tokens long enough for the index, sent as one ANDed MATCH.
  const matchTokens: string[] = [];
  for (const raw of q ? splitSearchTokens(q) : []) {
    const { negated, body } = parseNegatedSearchToken(raw);
    if (negated) {
      // A leading `-` (#523): NOT of what the token matches, whatever it is.
      // A file the condition says nothing about (NULL: no hash, no extension)
      // is kept, so an exclusion never drops a file for lacking the value it
      // names. Each negated word is its own condition: one MATCH of several
      // would exclude only the files carrying them all.
      sql += ` AND NOT COALESCE((${searchTokenCondition(db, body, args)}), 0)`;
      continue;
    }
    const directive = directiveCondition(db, body, args);
    if (directive !== null) {
      sql += ` AND ${directive}`;
      continue;
    }
    const words = searchTokenTerms(body);
    if (words.length === 1 && isTrigramSearchable(words[0])) {
      matchTokens.push(ftsPhrase(words[0]));
    } else {
      sql += ` AND ${anyOfCondition(freeTextGroup(body), args)}`;
    }
  }
  if (matchTokens.length > 0) {
    sql += " AND f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)";
    args.push(matchTokens.join(" "));
  }
  return sql;
}

/** The conditions of everything but the search box's text. */
function appendFilterConditions(
  db: DB,
  sql: string,
  args: unknown[],
  query: SearchQuery,
  sep?: string,
): string {
  if (query.folder) {
    const cond = folderCondition(
      folderRange(query.folder.path, sep),
      query.folder.recursive,
    );
    if (cond.sql) {
      sql += ` AND ${cond.sql}`;
      args.push(...cond.args);
    }
  }
  if (query.kinds?.length) {
    // A placeholder per kind, not json_each as for fileIds: the list is short
    // (the schema caps it), and without statistics the planner cannot size
    // json_each, so a single kind would lose idx_files_kind and scan every row.
    sql += ` AND f.kind IN (${query.kinds.map(() => "?").join(", ")})`;
    args.push(...query.kinds);
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
  if (query.addedFrom != null) {
    sql += " AND f.created_at >= ?";
    args.push(query.addedFrom);
  }
  if (query.addedTo != null) {
    sql += " AND f.created_at <= ?";
    args.push(query.addedTo);
  }
  if (query.playedFrom != null || query.playedTo != null) {
    // An IN over the range of idx_play_history_played rather than an EXISTS
    // per file: the latter probes the history of every file the sort walks
    // past, on each page of the list.
    sql +=
      " AND f.meta_key IN (SELECT meta_key FROM play_history WHERE played_at >= ? AND played_at <= ?)";
    args.push(
      query.playedFrom ?? Number.MIN_SAFE_INTEGER,
      query.playedTo ?? Number.MAX_SAFE_INTEGER,
    );
  }
  for (const tag of (query.tags ?? []).filter(Boolean)) {
    const ids = resolveTagIds(db, tag);
    if (ids.length === 0) {
      // Unknown tag: nothing can carry it, so short-circuit the whole query.
      sql += " AND 0";
      break;
    }
    // Pre-resolving to ids drops the `tags` join.
    sql += ` AND ${tagCondition(db, args, JSON.stringify(ids), query.tagSource)}`;
  }
  if (query.inProgress) {
    // An IN over the partial index rather than a test on the joined `m`: the
    // latter is only checked after the join, so it scans every file row.
    sql +=
      " AND f.meta_key IN (SELECT meta_key FROM file_meta WHERE resume_position IS NOT NULL)";
  }
  if (query.subtitles) {
    // Read from the ffprobe streams the scan stored in files.meta, so it needs
    // no column or rescan. There is no index for it: a list sorted by anything
    // but its pinned order tests every video for every page. The LIKE, a plain
    // text search over the stored JSON (written by JSON.stringify, so with no
    // space after the colon), drops the videos with no subtitle stream at all
    // before the JSON is parsed, about halving that walk. json_each then checks
    // the codec.
    sql += ` AND f.kind = 'video' AND f.meta LIKE '%"subtitle"%' AND EXISTS (SELECT 1 FROM json_each(f.meta, '$.streams') s
      WHERE json_extract(s.value, '$.codec_type') = 'subtitle'
        AND json_extract(s.value, '$.codec_name') IN (SELECT value FROM json_each(?)))`;
    args.push(TEXT_SUBTITLE_CODECS_JSON);
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
// The renderer builds one keyed cursor of its own, to open a list at a day
// (src/timeline/anchor.ts): the day's last second with an empty workspace
// id, which these tie rules keep every row on that second for. Changing the
// cursor's shape or the tiebreak changes what that cursor means.
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
    case "addedAt":
      // When the file entered the index; never NULL. Not offered by the sort
      // picker ("added" there is the id order): the timeline's "added" axis.
      return { expr: "f.created_at", nullable: false, cmp, idCmp: ">" };
    case "name":
      return { expr: "f.name_key", nullable: false, cmp, idCmp: cmp };
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
    case "addedAt":
      return row.addedAt;
    case "name":
      // The stored key is this function of the path (see backfillNameKeys).
      return naturalNameKey(row.relPath);
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
 * The index searchFiles pins with INDEXED BY for an unfiltered list in this
 * order, or null to leave the plan to SQLite (#363). Workspace DBs are never
 * ANALYZEd, and without statistics the planner takes idx_files_alive for
 * "deleted_at IS NULL" and sorts every live row in a temp b-tree for each
 * page. Walking the sort index instead reads only as far as a page needs.
 *
 * Only where the index yields the ORDER BY as it is. captured, btime and
 * created_at are indexed newest first, so their ascending orders would still
 * be sorted (for created_at, within each second, and a scan adds many files in
 * the same second). content_hash is indexed in its default ascending order,
 * so its descending order would be.
 *
 * Keep in step with orderByFor().
 */
function pinnedSortIndex(sort?: string, dir?: string): string | null {
  if (sort === "name") return "idx_files_alive_name_key";
  if (sort === "hash") {
    return resolveSortDir(sort, dir) === "asc" ? "idx_files_alive_hash" : null;
  }
  if (resolveSortDir(sort, dir) !== "desc") return null;
  switch (sort) {
    case "addedAt":
      return "idx_files_alive_added";
    case "captured":
      return "idx_files_alive_captured";
    case "btime":
      return "idx_files_alive_btime";
    default:
      return null;
  }
}

/**
 * Whether every token of the search box's text is an exclusion (`-ext:gif`,
 * `-draft`). An exclusion usually leaves most files, so walking the sort index
 * fills a page at once (#670).
 */
function isExclusionOnly(q: string | undefined): boolean {
  const tokens = q ? splitSearchTokens(q) : [];
  return (
    tokens.length > 0 &&
    tokens.every((token) => parseNegatedSearchToken(token).negated)
  );
}

/**
 * The index searchFiles pins for a list filtered only by exclusions, or null.
 * Only name and addedAt: when an exclusion leaves almost nothing, the walk
 * reads every live row, and in their index order the table rows come in about
 * the order they are stored. The captured, btime and hash orders are unrelated
 * to it, so the same walk reads the rows at random, measured at up to 5.7× the
 * unpinned time for captured on a database on disk (#670).
 */
function exclusionSortIndex(sort?: string, dir?: string): string | null {
  return sort === "name" || sort === "addedAt"
    ? pinnedSortIndex(sort, dir)
    : null;
}

/**
 * Search one workspace DB. With `seek`, the page starts right after that sort
 * position (keyset pagination — no OFFSET scan) and `nextCursor` is null: the
 * caller (crossWorkspace) tracks continuation itself. Without it, the legacy
 * numeric-offset contract applies. `skipTags` defers tag attachment to the
 * caller (the k-way merge discards rows, so batch-level attachment is wasted).
 * `uncapped` lifts the MAX_LIMIT cap for an internal caller that sizes its own
 * fetch (the k-way merge reading past a deep offset in one query).
 */
export function searchFiles(
  db: DB,
  query: SearchQuery,
  seek?: SeekPosition,
  opts?: { skipTags?: boolean; sep?: string; uncapped?: boolean },
): SearchResult {
  // The seek path allows one extra row (internal callers fetch limit+1 for
  // has-more detection); the IPC boundary still caps requests at MAX_LIMIT.
  const cap = opts?.uncapped ? Infinity : seek ? MAX_LIMIT + 1 : MAX_LIMIT;
  const limit = Math.max(1, Math.min(cap, query.limit ?? DEFAULT_LIMIT));
  const args: unknown[] = [];
  const text = appendTextConditions(db, "", args, query.q);
  const rest = appendFilterConditions(db, "", args, query, opts?.sep);
  const filters = text + rest;
  // Only an unfiltered list is pinned: without statistics nothing tells how
  // few rows a filter leaves, and for a rare one, walking the sort order to
  // fill a page reads every live row in index order (#363). A list filtered
  // only by exclusions is pinned in some orders (see exclusionSortIndex). Nor
  // is a page in the NULL tail of captured, btime or hash (a seek key without
  // a value): the index cannot reach that tail by the key, so it would walk
  // every row with a value first.
  const sortIndex =
    seek?.v === null || rest !== ""
      ? null
      : text === ""
        ? pinnedSortIndex(query.sort, query.sortDir)
        : isExclusionOnly(query.q)
          ? exclusionSortIndex(query.sort, query.sortDir)
          : null;
  const from = sortIndex
    ? `FROM files f INDEXED BY ${sortIndex} LEFT JOIN file_meta m ON m.meta_key = f.meta_key`
    : fromFor(query);
  let sql = `SELECT ${FILE_COLS} ${from} WHERE f.deleted_at IS NULL${filters}`;
  if (seek) {
    const seekArgs: unknown[] = [];
    const cond = appendSeekCondition(seekArgs, seek, query.sort, query.sortDir);
    // Nothing follows the key. Not sent as "AND (0)": SQLite rejects a WHERE
    // it can prove false under INDEXED BY ("no query solution"). The filters
    // can write "AND 0" too, but only a list they leave unpinned: an
    // exclusion writes "NOT COALESCE(...)", never a bare 0.
    if (cond === "0") return { items: [], nextCursor: null };
    sql += ` AND (${cond})`;
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
 * pinnedSortIndex() pins an index only for an order that index yields as it
 * is; changing an order here can leave its pinned index sorting again.
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
    case "addedAt":
      return `f.created_at ${direction}, f.id ASC`;
    case "name":
      // Natural order (#292). The id tiebreak follows the main direction so
      // both directions map onto a single scan of idx_files_alive_name_key
      // (forward/backward); a fixed "id ASC" would force a temp b-tree for the
      // DESC case.
      return `f.name_key ${direction}, f.id ${direction}`;
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
 *
 * Every kind takes part, audio included: Discover renders a track's cover art
 * (or the kind's glyph) and plays it through the bottom bar, so nothing here
 * needs to be filtered beyond what the caller's SearchQuery asks for.
 */
export function randomFiles(db: DB, query: SearchQuery): FileRow[] {
  const lim = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? 20));
  const args: unknown[] = [];
  let sql = `SELECT f.id ${fromFor(query)} WHERE f.deleted_at IS NULL`;
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
