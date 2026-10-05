// Per-day file counts for the heatmap: how many of the files a search matches
// fall on each calendar day of a range, by one metric.
import type { DB } from "../db.js";
import type { ActivityMetric } from "../../../shared/ipc/activity.js";
import { addDays, formatDay, parseDay } from "../../../shared/day.js";
import { DAY_EXPR, dayBounds, dayCondition } from "./dayRange.js";
import { appendSearchConditions, FILE_FROM } from "./files.js";
import type { SearchQuery } from "../types.js";

/** The heatmap has no folder form and counts every day itself, so those parts
 *  of a query are dropped here (paging and sorting never reach the SQL). */
function activityQuery(query: SearchQuery): SearchQuery {
  return { ...query, folder: undefined, day: undefined };
}

/**
 * The days from `from` to `to` as the second each starts at, plus the second
 * the last one ends at: day `i` is [starts[i], starts[i + 1]).
 */
function dayStarts(from: Date, to: Date): { days: string[]; starts: number[] } {
  const days: string[] = [];
  const starts: number[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(formatDay(day));
    starts.push(Math.floor(day.getTime() / 1000));
  }
  starts.push(Math.floor(addDays(to, 1).getTime() / 1000));
  return { days, starts };
}

/** Index of the day holding `ts`: the last start at or before it. */
function dayIndexOf(starts: number[], ts: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= ts) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Files per local calendar day ("YYYY-MM-DD") between `from` and `to`, both
 * included; days with nothing on them are absent. A file counts once per day
 * however often it was played on it, so a day's count is the number of rows
 * the search lists for that day (see dayCondition).
 *
 * The timestamps are read and put into days here rather than grouped in SQL:
 * the list reads a day as the seconds between two local midnights worked out
 * by Date (see dayBounds), and SQLite's own 'localtime' does not draw every
 * midnight where Date does — outside 1970–2037 anywhere, and wherever the
 * platform's C library knows only today's daylight-saving rules.
 */
export function activityDays(
  db: DB,
  query: SearchQuery,
  metric: ActivityMetric,
  from: string,
  to: string,
): Map<string, number> {
  const first = parseDay(from);
  const last = parseDay(to);
  const bounds = dayBounds(from, to);
  if (!first || !last || !bounds || first > last) return new Map();
  const { days, starts } = dayStarts(first, last);
  const counts = new Array<number>(days.length).fill(0);
  const args: unknown[] = [];

  if (metric === "played") {
    // Driven by the range of play history, which idx_play_history_played
    // serves, rather than by a test per file.
    let sql = `SELECT f.id AS id, ph.played_at AS ts
      ${FILE_FROM} JOIN play_history ph ON ph.meta_key = f.meta_key
      WHERE f.deleted_at IS NULL AND ph.played_at >= ? AND ph.played_at < ?`;
    args.push(...bounds);
    sql = appendSearchConditions(db, sql, args, activityQuery(query));
    const seen = new Set<number>();
    for (const row of db.prepare(sql).iterate(...args) as IterableIterator<{
      id: number;
      ts: number;
    }>) {
      const i = dayIndexOf(starts, row.ts);
      // One number per (file, day): there are fewer days than the multiplier.
      const key = row.id * starts.length + i;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[i]++;
    }
  } else {
    const cond = dayCondition(metric, ...bounds);
    let sql = `SELECT ${DAY_EXPR[metric]} AS ts
      ${FILE_FROM} WHERE f.deleted_at IS NULL AND ${cond.sql}`;
    args.push(...cond.args);
    sql = appendSearchConditions(db, sql, args, activityQuery(query));
    for (const ts of db
      .prepare(sql)
      .pluck()
      .iterate(...args) as IterableIterator<number>)
      counts[dayIndexOf(starts, ts)]++;
  }

  const out = new Map<string, number>();
  counts.forEach((count, i) => {
    if (count > 0) out.set(days[i], count);
  });
  return out;
}
