// Timeline view payload types and shared constants. The payload only travels
// main → renderer, so it is typed rather than Zod-validated (see channels.ts).

/**
 * The date a timeline is ordered and cut into days by (each has a sort key
 * of the same date, TIMELINE_SORT_KEYS, so the list under the days is
 * files_search sorted by the axis), in the order they are offered:
 * - "btime": the filesystem's birth time (the default),
 * - "added": when the file entered the index,
 * - "captured": the capture date.
 * A file without the date is on no day (see TimelineCounts.undated); every
 * file has the day it was added.
 */
export const TIMELINE_AXES = ["btime", "added", "captured"] as const;
export type TimelineAxis = (typeof TIMELINE_AXES)[number];

export function isTimelineAxis(v: unknown): v is TimelineAxis {
  return TIMELINE_AXES.includes(v as TimelineAxis);
}

/** The search's sort key ordering the list by each axis. */
export const TIMELINE_SORT_KEYS: Record<TimelineAxis, string> = {
  btime: "btime",
  added: "addedAt",
  captured: "captured",
};

/** One calendar day and the files dated on it. */
export interface TimelineDay {
  /** "YYYY-MM-DD", in the main process's local time. */
  day: string;
  count: number;
}

/**
 * The days the files of a search fall on. Their counts and `undated` add up
 * to the length of the list the same search gives.
 */
export interface TimelineCounts {
  /** The days holding at least one file, newest first. */
  days: TimelineDay[];
  /** Files with no date on the axis: the tail of the list. */
  undated: number;
}
