// Timeline view payload types and shared constants. The payload only travels
// main → renderer, so it is typed rather than Zod-validated (see channels.ts).

/**
 * The date a timeline is ordered and cut into days by. The values are the
 * search's sort keys of the same dates, so the list under the days is
 * files_search sorted by the axis:
 * - "captured": the capture date,
 * - "btime": the filesystem's birth time.
 * A file without the date is on no day (see TimelineCounts.undated).
 */
export const TIMELINE_AXES = ["captured", "btime"] as const;
export type TimelineAxis = (typeof TIMELINE_AXES)[number];

export function isTimelineAxis(v: unknown): v is TimelineAxis {
  return TIMELINE_AXES.includes(v as TimelineAxis);
}

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
