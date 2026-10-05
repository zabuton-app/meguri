// The files one calendar day of the heatmap counts, as a WHERE
// condition. Shared by the search (the day's file list) and the per-day counts
// (queries/activity.ts), so a cell's number is the length of the list it opens.
import type { ActivityMetric } from "../../../shared/ipc/activity.js";
import { addDays, parseDay } from "../../../shared/day.js";

/**
 * The timestamp (Unix seconds) a file is dated by, for the metrics read off
 * the file row itself. "played" has no such column: a file has one play
 * history row per play.
 */
export const DAY_EXPR: Record<Exclude<ActivityMetric, "played">, string> = {
  // Most videos carry no capture date; the modification time stands in.
  captured: "COALESCE(f.captured_at, f.mtime)",
  // NULL where the filesystem reports no birth time: such a file is in no range.
  created: "f.btime",
  added: "f.created_at",
};

/** Unix seconds of the local midnight starting `from` and the one ending `to`
 *  (both days included); null when either is not a calendar day. */
export function dayBounds(from: string, to: string): [number, number] | null {
  const start = parseDay(from);
  const last = parseDay(to);
  if (!start || !last) return null;
  return [
    Math.floor(start.getTime() / 1000),
    Math.floor(addDays(last, 1).getTime() / 1000),
  ];
}

/** Condition on the `f` alias keeping the files `metric` counts in [start, end). */
export function dayCondition(
  metric: ActivityMetric,
  start: number,
  end: number,
): { sql: string; args: number[] } {
  if (metric === "played") {
    return {
      sql: "EXISTS (SELECT 1 FROM play_history dp WHERE dp.meta_key = f.meta_key AND dp.played_at >= ? AND dp.played_at < ?)",
      args: [start, end],
    };
  }
  const expr = DAY_EXPR[metric];
  return { sql: `${expr} >= ? AND ${expr} < ?`, args: [start, end] };
}
