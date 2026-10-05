// The heatmap's calendar: which days a range covers, laid out as
// week columns, and how dark a day's cell is drawn.
import { addDays, formatDay } from "@shared/day";

/** Days in a week column; the first row is Sunday. */
export const WEEK_DAYS = 7;
/** Shades a cell can take, 0 being a day with nothing on it. */
export const LEVELS = 5;

export interface HeatmapRange {
  /** First and last day shown, at local midnight, both included. */
  from: Date;
  to: Date;
}

function startOfDay(date: Date): Date {
  return addDays(date, 0);
}

/**
 * The days one page of the graph shows. With no year, the 53 weeks ending
 * today, starting on a Sunday so the first column is whole. With a year, that
 * calendar year, cut at today when it is the current one.
 */
export function rangeFor(year: number | null, today: Date): HeatmapRange {
  const now = startOfDay(today);
  if (year === null) {
    const back = addDays(now, -(52 * WEEK_DAYS));
    return { from: addDays(back, -back.getDay()), to: now };
  }
  const last = new Date(year, 11, 31);
  return { from: new Date(year, 0, 1), to: last > now ? now : last };
}

/**
 * The range as week columns, each a Sunday-first run of seven slots. Slots
 * outside the range (before its first day, after its last) are null.
 */
export function buildWeeks(range: HeatmapRange): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  let day = addDays(range.from, -range.from.getDay());
  while (day <= range.to) {
    const week: (string | null)[] = [];
    for (let i = 0; i < WEEK_DAYS; i++) {
      week.push(day >= range.from && day <= range.to ? formatDay(day) : null);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * The month (0–11) to name above each week column: a column gets a label when
 * it holds the first day shown of a month. The label of a month that starts in
 * the range's last column is left out, where there is no room to draw it.
 */
export function monthLabels(weeks: (string | null)[][]): (number | null)[] {
  let last = -1;
  return weeks.map((week, col) => {
    const first = week.find((d) => d !== null);
    if (!first) return null;
    const lastDay = [...week].reverse().find((d) => d !== null) ?? first;
    // A column straddling two months is named for the one that starts in it.
    const month = Number(lastDay.slice(5, 7)) - 1;
    if (month === last) return null;
    last = month;
    return col === weeks.length - 1 && weeks.length > 1 ? null : month;
  });
}

/**
 * The shade of a day holding `count` files when the busiest day shown holds
 * `max`. A square-root scale: one day far above the rest (a big import) would
 * otherwise leave every other day in the lightest shade.
 */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const level = Math.ceil(Math.sqrt(count / max) * (LEVELS - 1));
  return Math.min(LEVELS - 1, Math.max(1, level));
}
