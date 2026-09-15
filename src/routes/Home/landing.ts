// Home landing shelves ("Recently added" / "Picks for today"): the pure rules
// the shelf area follows, kept apart from the components so they can be tested
// without rendering. See HomeLanding.tsx for the UI and useHomeShelves.ts for
// the queries.
import type { SearchQuery } from "@/ipc/types";
import { cleanDiscoverFilter } from "./utils";

/** localStorage key for the remembered collapsed state of the shelf area. */
export const LANDING_COLLAPSED_KEY = "meguri.homeLanding.collapsed";

/** How many files each shelf asks for (spec: at most 20 per shelf). */
export const RECENT_LIMIT = 12;
export const PICKS_LIMIT = 8;

/** The list sort "See all" on the Recently added shelf applies. */
export const RECENT_SORT: Pick<SearchQuery, "sort" | "sortDir"> = {
  sort: "btime",
  sortDir: "desc",
};

/**
 * Whether the shelf area may show at all: only over the plain library, with
 * no search or filter narrowing it. The sort is deliberately not a filter —
 * "See all" changes it and the shelves stay — and collections (user or Watch
 * Later) are out of scope for the shelves.
 */
export function isLandingEligible(
  filter: SearchQuery,
  collectionActive: boolean,
): boolean {
  if (collectionActive) return false;
  return Object.keys(cleanDiscoverFilter(filter)).length === 0;
}

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
