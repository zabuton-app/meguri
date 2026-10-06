// Calendar months as "YYYY-MM" strings in local time: the rail's unit, made
// from the days the list is cut into (see shared/day.ts for those).

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** The local midnight a "YYYY-MM" month starts at; null for anything else. */
export function parseMonth(month: string): Date | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12) return null;
  // Not the Date constructor, which reads a year below 100 as 19xx.
  const date = new Date(0);
  date.setFullYear(y, mo - 1, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** A local date's month as "YYYY-MM". */
export function formatMonth(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** The first day of the month after the one `date` is in, at local midnight. */
export function nextMonth(date: Date): Date {
  const next = new Date(date);
  next.setFullYear(date.getFullYear(), date.getMonth() + 1, 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * A month as a range of Unix seconds with both ends included — its first
 * second and its last — the form the search's date ranges take (see
 * daySeconds).
 */
export function monthSeconds(start: Date): [from: number, to: number] {
  const first = new Date(start);
  first.setFullYear(start.getFullYear(), start.getMonth(), 1);
  first.setHours(0, 0, 0, 0);
  return [
    Math.floor(first.getTime() / 1000),
    Math.floor(nextMonth(first).getTime() / 1000) - 1,
  ];
}
