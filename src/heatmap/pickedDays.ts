// The day picked on the heatmap is not state of its own: it is the search's
// date range for the metric shown (see ACTIVITY_RANGE_FIELDS), the same
// condition the filter bar offers under "More conditions". Reading the range
// back marks the cells; picking a cell, or dragging across several, writes it.
import type { SearchQuery } from "@/ipc/types";
import { daySeconds, formatDay, parseDay } from "@shared/day";
import {
  ACTIVITY_RANGE_FIELDS,
  type ActivityMetric,
} from "@shared/ipc/activity";

/** The days a date range covers, both included; null for an open end. */
export interface PickedDays {
  from: string | null;
  to: string | null;
}

function dayOf(sec: number | undefined): string | null {
  return sec == null ? null : formatDay(new Date(sec * 1000));
}

/** The days the query's range for `metric` covers; null when it has none. */
export function pickedDays(
  query: SearchQuery,
  metric: ActivityMetric,
): PickedDays | null {
  const [from, to] = ACTIVITY_RANGE_FIELDS[metric];
  if (query[from] == null && query[to] == null) return null;
  return { from: dayOf(query[from]), to: dayOf(query[to]) };
}

/** The one day a range covers, when it is exactly one. */
export function singleDay(picked: PickedDays | null): string | null {
  return picked?.from != null && picked.from === picked.to ? picked.from : null;
}

export function isPicked(picked: PickedDays | null, day: string): boolean {
  if (!picked) return false;
  return (
    (picked.from == null || day >= picked.from) &&
    (picked.to == null || day <= picked.to)
  );
}

/** Days picked on the heatmap, first and last, both included. */
export interface DayRange {
  from: string;
  to: string;
}

/** The two days in calendar order, whichever was picked first. */
export function orderedRange(a: string, b: string): DayRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/**
 * The query with its range for `metric` set to these days, or removed for
 * null. The same object comes back when there is nothing to remove, so
 * clearing a range that is not there refetches nothing.
 */
export function withPickedDays(
  query: SearchQuery,
  metric: ActivityMetric,
  range: DayRange | null,
): SearchQuery {
  const [from, to] = ACTIVITY_RANGE_FIELDS[metric];
  const first = range ? parseDay(range.from) : null;
  const last = range ? parseDay(range.to) : null;
  if (!first || !last) {
    if (query[from] == null && query[to] == null) return query;
    const next = { ...query };
    delete next[from];
    delete next[to];
    return next;
  }
  return {
    ...query,
    [from]: daySeconds(first)[0],
    [to]: daySeconds(last)[1],
  };
}

/** The query without its range for `metric`: what the heatmap counts over. */
export function withoutPickedDays(
  query: SearchQuery,
  metric: ActivityMetric,
): SearchQuery {
  return withPickedDays(query, metric, null);
}
