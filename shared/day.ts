// Calendar days as "YYYY-MM-DD" strings in local time: the form a day crosses
// IPC in, so that each side resolves it in its own zone and no timestamp has
// to mean "that day" on both.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local midnight a "YYYY-MM-DD" day starts at; null for anything else. */
export function parseDay(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Not the Date constructor, which reads a year below 100 as 19xx.
  const date = new Date(0);
  date.setFullYear(y, mo - 1, d);
  date.setHours(0, 0, 0, 0);
  // Date rolls an impossible day over (02-31 → 03-03) instead of refusing it.
  return date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d
    ? date
    : null;
}

/** A local date as "YYYY-MM-DD". */
export function formatDay(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The day `n` days after `date` (before, for a negative `n`), at local midnight. */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Days from `from` to `to`, both included; calendar days, so a DST change
 *  inside the range does not shift the count. */
export function daySpan(from: Date, to: Date): number {
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}

/**
 * A day as a range of Unix seconds with both ends included — its first second
 * and its last — the form the search's date ranges take.
 */
export function daySeconds(date: Date): [from: number, to: number] {
  return [
    Math.floor(date.getTime() / 1000),
    Math.floor(addDays(date, 1).getTime() / 1000) - 1,
  ];
}
