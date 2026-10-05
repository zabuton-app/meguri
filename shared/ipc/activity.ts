// Heatmap (contribution graph) payload types and shared constants. The payload only
// travels main → renderer, so it is typed rather than Zod-validated (see
// channels.ts).

/**
 * What a day's count is made of:
 * - "played": files played or viewed that day (their play history),
 * - "captured": files taken that day (the capture date, or the file's
 *   modification time where none was read),
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
