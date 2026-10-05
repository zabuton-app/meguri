// Heatmap (contribution graph) payload types and shared constants. The payload only
// travels main → renderer, so it is typed rather than Zod-validated (see
// channels.ts).

/**
 * What a day's count is made of:
 * - "played": files played or viewed that day (their play history),
 * - "captured": files taken that day (the capture date; a file without one is
 *   on no day),
 * - "created": files created on disk that day (the filesystem's birth time;
 *   a file without one is on no day),
 * - "added": files that entered the index that day.
 */
export const ACTIVITY_METRICS = [
  "played",
  "captured",
  "created",
  "added",
] as const;
export type ActivityMetric = (typeof ACTIVITY_METRICS)[number];

export function isActivityMetric(v: unknown): v is ActivityMetric {
  return ACTIVITY_METRICS.includes(v as ActivityMetric);
}

/**
 * The pair of SearchQuery fields (Unix seconds, both ends included) that
 * narrows a list to a range of each metric's dates. A day picked on the
 * heatmap is written to these, so it is the same condition the filter bar
 * offers as a date range; the heatmap's own counts leave the pair of the
 * metric shown out, or only the picked day would have anything on it.
 */
export const ACTIVITY_RANGE_FIELDS = {
  played: ["playedFrom", "playedTo"],
  captured: ["capturedFrom", "capturedTo"],
  created: ["btimeFrom", "btimeTo"],
  added: ["addedFrom", "addedTo"],
} as const satisfies Record<ActivityMetric, readonly [string, string]>;

/** Days one request may span: a year, and the weeks that pad it out. */
export const ACTIVITY_MAX_DAYS = 400;

/** One calendar day and the files counted on it. */
export interface ActivityDay {
  /** "YYYY-MM-DD", in the main process's local time. */
  date: string;
  count: number;
}

/** The days of a range that have anything on them, oldest first. */
export interface ActivityDays {
  days: ActivityDay[];
}
