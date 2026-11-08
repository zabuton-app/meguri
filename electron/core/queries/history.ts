// Play-history timeline queries. Unlike the per-file history in fileDetail(), these
// list events across the whole workspace, newest first, with pagination.
import type { DB } from "../db.js";
import { FILE_COLS, FILE_FROM } from "./files.js";
import type { HistoryEntryRow, HistoryQuery, HistoryPage } from "../types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface RawEvent {
  id: number;
  meta_key: string;
  played_at: number;
  via: "browser" | "external";
  position: number | null;
}

// Raw events are streamed in index order in batches of this size while
// collapsing runs in JS.
const RAW_BATCH = 500;

// play_history is shared by every workspace. Streaming it newest-first reads
// through every other workspace's events too, so a workspace that holds only
// a small share of them collects its own instead (idx_play_history_meta_played)
// and sorts those: at most OWN_SORT_MAX of them, and fewer than one in
// OWN_SHARE of the library's.
const OWN_SORT_MAX = 20_000;
const OWN_SHARE = 4;

/** Whether this workspace's events are few enough, next to the library's,
 *  to be collected and sorted rather than found by streaming them all. */
function collectsOwnEvents(db: DB, via: HistoryQuery["via"]): boolean {
  // An upper bound on the number of events, read off the end of the rowid
  // index rather than counted.
  const total =
    (db.prepare("SELECT max(id) FROM play_history").pluck().get() as
      number | null) ?? 0;
  if (total <= OWN_SORT_MAX) return false;
  const viaSql = via ? "AND via = ? " : "";
  const own = db
    .prepare(
      `SELECT count(*) FROM (SELECT 1 FROM play_history
         WHERE meta_key IN (SELECT meta_key FROM main.files WHERE deleted_at IS NULL)
         ${viaSql}LIMIT ?)`,
    )
    .pluck()
    .get(...(via ? [via] : []), OWN_SORT_MAX + 1) as number;
  return own <= OWN_SORT_MAX && own * OWN_SHARE < total;
}

/**
 * List play events newest-first, collapsing consecutive runs of the same file
 * into one row (re-plays while watching a video would otherwise flood the
 * timeline). The old implementation collapsed in SQL with a LAG window over
 * the whole table plus a correlated COUNT per row — a full scan + sort on
 * every page once the history grew. Instead, stream raw events straight off
 * idx_play_history_played (played_at DESC, id DESC) in keyset batches,
 * collapse the runs in JS, and resolve file rows / play counts with small
 * indexed lookups. The numeric offset cursor (over collapsed rows) is
 * unchanged, matching the searchFiles contract and the All view's merge.
 */
export function listPlayHistory(db: DB, query: HistoryQuery): HistoryPage {
  const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, query.cursor ?? 0);

  const viaSql = query.via ? "via = ? AND " : "";
  // play_history is shared by every workspace: only events for a file alive in
  // this one, filtered in SQL so the stream does not hand JS every other
  // workspace's events to drop one lookup at a time. Either streamed in
  // idx_play_history_played order and checked against this workspace's files,
  // or, when they are a small share (collectsOwnEvents), collected per file
  // and sorted: the unary + on played_at and id, in ORDER BY and in the
  // keyset, keeps the planner off idx_play_history_played, which would bring
  // the stream back (a range on played_at searched there reads every
  // workspace's events in it).
  const own = collectsOwnEvents(db, query.via);
  const aliveHere = own
    ? "meta_key IN (SELECT meta_key FROM main.files WHERE deleted_at IS NULL)"
    : `EXISTS (SELECT 1 FROM main.files f
     WHERE f.meta_key = play_history.meta_key AND f.deleted_at IS NULL)`;
  const [at, id] = own ? ["+played_at", "+id"] : ["played_at", "id"];
  const order = `ORDER BY ${at} DESC, ${id} DESC`;
  const firstBatch = db.prepare(
    `SELECT id, meta_key, played_at, via, position FROM play_history
     WHERE ${viaSql}${aliveHere} ${order} LIMIT ?`,
  );
  const nextBatch = db.prepare(
    `SELECT id, meta_key, played_at, via, position FROM play_history
     WHERE ${viaSql}(${at} < ? OR (${at} = ? AND ${id} < ?)) AND ${aliveHere}
     ${order} LIMIT ?`,
  );
  // Representative alive file for a run's meta_key (MIN(id) mirrors the old
  // SQL); a run whose file is soft-deleted/gone drops out, same as the old
  // INNER JOIN — including while skipping toward the offset.
  const fileStmt = db.prepare(
    `SELECT ${FILE_COLS} ${FILE_FROM}
     WHERE f.meta_key = ? AND f.deleted_at IS NULL ORDER BY f.id LIMIT 1`,
  );

  const kept: HistoryEntryRow[] = [];
  // meta_key per kept row (FILE_COLS doesn't expose it), for the count lookup.
  const keptKeys: string[] = [];
  const want = limit + 1;
  let skipped = 0;
  let prevKey: string | null = null;
  let seek: RawEvent | null = null;

  outer: for (;;) {
    const args: unknown[] = query.via ? [query.via] : [];
    if (seek) args.push(seek.played_at, seek.played_at, seek.id);
    args.push(RAW_BATCH);
    const rows = (seek ? nextBatch : firstBatch).all(...args) as RawEvent[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (prevKey === row.meta_key) continue; // same run, already represented
      prevKey = row.meta_key;
      const f = fileStmt.get(row.meta_key) as HistoryEntryRow | undefined;
      if (!f) continue;
      if (skipped < offset) {
        skipped++;
        continue;
      }
      kept.push({
        ...f,
        historyId: row.id,
        playedAt: row.played_at,
        via: row.via,
        position: row.position,
        playCount: 0, // filled below for the returned page only
      });
      keptKeys.push(row.meta_key);
      if (kept.length >= want) break outer;
    }
    if (rows.length < RAW_BATCH) break;
    seek = rows[rows.length - 1];
  }

  const items = kept.slice(0, limit);
  const nextCursor = kept.length > limit ? offset + limit : null;

  // Total play counts for just the returned rows, in one grouped query
  // (idx_play_history_meta_played) instead of a correlated COUNT per candidate row.
  if (items.length > 0) {
    const keys = [...new Set(keptKeys.slice(0, items.length))];
    const ph = keys.map(() => "?").join(",");
    const counts = db
      .prepare(
        `SELECT meta_key AS k, COUNT(*) AS c FROM play_history
         WHERE meta_key IN (${ph}) GROUP BY meta_key`,
      )
      .all(...keys) as { k: string; c: number }[];
    const byKey = new Map(counts.map((r) => [r.k, r.c]));
    items.forEach((it, i) => {
      it.playCount = byKey.get(keptKeys[i]) ?? 0;
    });
  }

  return { items, nextCursor };
}

/**
 * Delete every play event in this workspace, and the resume points with them:
 * a progress bar or the "In progress" filter would otherwise still say what was
 * watched after the user asked for that record to go.
 */
export function clearPlayHistory(db: DB): void {
  db.transaction(() => {
    db.prepare("DELETE FROM play_history").run();
    db.prepare(
      "UPDATE file_meta SET resume_position = NULL WHERE resume_position IS NOT NULL",
    ).run();
  })();
}
