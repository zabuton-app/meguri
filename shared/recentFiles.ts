export const RECENT_PERIODS = [
  "today",
  "thisWeek",
  "lastHour",
  "last24Hours",
  "last7Days",
] as const;
export const RECENT_BASES = ["added", "created"] as const;
export type RecentPeriod = (typeof RECENT_PERIODS)[number];
export type RecentBasis = (typeof RECENT_BASES)[number];
export interface RecentFiles {
  period: RecentPeriod;
  basis: RecentBasis;
}

/** Calendar windows use local time; rolling windows use elapsed seconds. */
export function recentFilesRange(
  period: RecentPeriod,
  now = new Date(),
): [number, number] {
  const end = Math.floor(now.getTime() / 1000);
  if (period === "lastHour") return [end - 3600, end];
  if (period === "last24Hours") return [end - 86400, end];
  if (period === "last7Days") return [end - 7 * 86400, end];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "thisWeek")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return [Math.floor(start.getTime() / 1000), end];
}
