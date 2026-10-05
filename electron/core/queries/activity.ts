// Per-day file counts for the heatmap: how many of the files a search matches
// fall on each calendar day of a range, by one metric.
import type { DB } from "../db.js";
import {
  ACTIVITY_RANGE_FIELDS,
  type ActivityMetric,
} from "../../../shared/ipc/activity.js";
import { addDays, formatDay, parseDay } from "../../../shared/day.js";
import { appendSearchConditions, FILE_FROM } from "./files.js";
import type { SearchQuery } from "../types.js";

/**
 * The timestamp (Unix seconds) a file is dated by, for the metrics read off
 * the file row itself: the column the search's date range of the same name
 * tests (see ACTIVITY_RANGE_FIELDS), so a day's count is the length of the
 * list that range gives. NULL puts a file on no day. "played" has no such
 * column: a file has one play history row per play.
 */
const DAY_EXPR: Record<Exclude<ActivityMetric, "played">, string> = {
  captured: "f.captured_at",
  created: "f.btime",
  added: "f.created_at",
};

/**
 * What the counts ignore in a query: the folder (the heatmap has no folder
 * form) and the metric's own date range, which is the day picked on the
 * heatmap — counted with it, every other day would be empty. Paging and
 * sorting never reach the SQL.
 */
function activityQuery(
  query: SearchQuery,
  metric: ActivityMetric,
): SearchQuery {
  const [from, to] = ACTIVITY_RANGE_FIELDS[metric];
  return { ...query, folder: undefined, [from]: undefined, [to]: undefined };
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
 * the search lists when its date range is that day.
 *
 * The timestamps are read and put into days here rather than grouped in SQL:
 * a date range is seconds between two local midnights worked out by Date, and
 * SQLite's own 'localtime' does not draw every midnight where Date does —
 * outside 1970–2037 anywhere, and wherever the platform's C library knows
 * only today's daylight-saving rules.
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
  if (!first || !last || first > last) return new Map();
  const { days, starts } = dayStarts(first, last);
  const bounds = [starts[0], starts[starts.length - 1]];
  const counts = new Array<number>(days.length).fill(0);
  const args: unknown[] = [...bounds];
  const q = activityQuery(query, metric);

  if (metric === "played") {
    // One row per play in the range. SQLite picks the join order: it walks
    // the files and probes each one's history, which costs the same whatever
    // the range but stays cheap under a selective filter.
    let sql = `SELECT f.id AS id, ph.played_at AS ts
      ${FILE_FROM} JOIN play_history ph ON ph.meta_key = f.meta_key
      WHERE f.deleted_at IS NULL AND ph.played_at >= ? AND ph.played_at < ?`;
    sql = appendSearchConditions(db, sql, args, q);
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
    const expr = DAY_EXPR[metric];
    let sql = `SELECT ${expr} AS ts
      ${FILE_FROM} WHERE f.deleted_at IS NULL AND ${expr} >= ? AND ${expr} < ?`;
    sql = appendSearchConditions(db, sql, args, q);
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
