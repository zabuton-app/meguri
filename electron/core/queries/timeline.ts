// Per-day file counts for the timeline: how many of the files a search
// matches are dated on each calendar day, by one axis.
import type { DB } from "../db.js";
import type { TimelineAxis } from "../../../shared/ipc/timeline.js";
import { daySeconds, formatDay } from "../../../shared/day.js";
import { appendSearchConditions, fromFor } from "./files.js";
import type { SearchQuery } from "../types.js";

/**
 * The timestamp (Unix seconds) a file is dated by: the column the sort key of
 * the same name orders by (see sortSpecFor), so the days are cut along the
 * order the list is read in.
 */
const AXIS_EXPR: Record<TimelineAxis, string> = {
  captured: "f.captured_at",
  btime: "f.btime",
};

export interface DayCounts {
  /** "YYYY-MM-DD" → files dated on it; days with none are absent. */
  days: Map<string, number>;
  /** Files with no date on the axis. */
  undated: number;
}

/**
 * Files per local calendar day, over every file the query matches. Unlike
 * the heatmap's counts (activityDays), the axis's own date range stays in the
 * query: the timeline is the list that range gives, cut into days.
 *
 * The timestamps are read and put into days here rather than grouped in SQL,
 * for the reason activityDays gives: a day is seconds between two local
 * midnights worked out by Date, and SQLite's 'localtime' does not draw every
 * midnight where Date does.
 */
export function timelineCounts(
  db: DB,
  query: SearchQuery,
  axis: TimelineAxis,
): DayCounts {
  const expr = AXIS_EXPR[axis];
  const args: unknown[] = [];
  let sql = `SELECT ${expr} AS ts ${fromFor(query)} WHERE f.deleted_at IS NULL`;
  sql = appendSearchConditions(db, sql, args, query);

  const days = new Map<string, number>();
  let undated = 0;
  // Timestamps arrive in no order, but files of one import sit together: the
  // day last resolved answers most rows without building a Date.
  let from = 1;
  let to = 0;
  let day = "";
  for (const ts of db
    .prepare(sql)
    .pluck()
    .iterate(...args) as IterableIterator<number | null>) {
    if (ts == null) {
      undated++;
      continue;
    }
    if (ts < from || ts > to) {
      const date = new Date(ts * 1000);
      [from, to] = daySeconds(date);
      day = formatDay(date);
    }
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return { days, undated };
}
