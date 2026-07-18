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
  const firstBatch = db.prepare(
    `SELECT id, meta_key, played_at, via, position FROM play_history
     WHERE ${viaSql}1 ORDER BY played_at DESC, id DESC LIMIT ?`,
  );
  const nextBatch = db.prepare(
    `SELECT id, meta_key, played_at, via, position FROM play_history
     WHERE ${viaSql}(played_at < ? OR (played_at = ? AND id < ?))
     ORDER BY played_at DESC, id DESC LIMIT ?`,
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
  // (idx_play_history_meta) instead of a correlated COUNT per candidate row.
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

/** Delete every play event in this workspace. */
export function clearPlayHistory(db: DB): void {
  db.prepare("DELETE FROM play_history").run();
}
