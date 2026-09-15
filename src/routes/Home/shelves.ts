// Home view shelves ("Recently added" / "Picks for today"): the pure rules
// the shelves follow, kept apart from the components so they can be tested
// without rendering. See HomeShelves.tsx for the UI and useHomeShelves.ts for
// the queries.
import type { SearchQuery } from "@/ipc/types";

/** How many files each shelf asks for (spec: at most 20 per shelf). The
 *  single-row shelves show only as many as their grid has columns. */
export const RECENT_LIMIT = 20;
export const PLAYED_LIMIT = 20;
/** Play-history rows read for the played shelf: the history repeats a file
 *  played at different times, so more are read than are kept. */
export const PLAYED_HISTORY_READ = 60;
/** One hero plus up to 19 beside it (the same size as Discovery's queue);
 *  the view shows only as many of those as fill whole rows of its grid. */
export const PICKS_LIMIT = 20;

/** The list sort "See all" on the Recently added shelf applies (in the "All" view). */
export const RECENT_SORT: Pick<SearchQuery, "sort" | "sortDir"> = {
  sort: "btime",
  sortDir: "desc",
};

/**
 * The calendar day (local time) the picks are seeded for, as `YYYY-MM-DD`.
 * Part of the picks query key, so a new day is a new sample and the same day
 * keeps the one already drawn.
 */
export function picksDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Milliseconds from `now` until the next local midnight (at least 1 ms). */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}

/**
 * The newest play of each file, in play order, at most `limit` of them. The
 * history only collapses back-to-back plays of one file, so a file played
 * again later appears once per run.
 */
export function distinctPlayed<T extends { id: number; workspaceId: string }>(
  entries: readonly T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = `${entry.workspaceId}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
