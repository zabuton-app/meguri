// The date ranges a list can be narrowed by. One table, read by everything on
// the renderer side that has to know them all — the panel's inputs, the chips,
// a saved search's description and the list of fields a saved search keeps —
// so a range added here shows up in each instead of in whichever was
// remembered. (The SQL each one runs is in electron/core/queries/files.ts.)
import type { TranslationKey } from "@/i18n/locales/ja";
import type { SearchQuery } from "@/ipc/types";
import { daySeconds, formatDay, parseDay } from "@shared/day";

/** A SearchQuery field holding a number. */
type NumberField = {
  [K in keyof SearchQuery]-?: NonNullable<SearchQuery[K]> extends number
    ? K
    : never;
}[keyof SearchQuery];

export interface DateRangeSpec {
  /** Stable identity of the condition (chip key, test targeting). */
  key: string;
  label: TranslationKey;
  /** The fields holding each end, Unix seconds, both ends included. */
  from: NumberField;
  to: NumberField;
}

/** In the order they are offered and described. */
export const DATE_RANGES: readonly DateRangeSpec[] = [
  {
    key: "capturedAt",
    label: "filter.capturedAt",
    from: "capturedFrom",
    to: "capturedTo",
  },
  { key: "btime", label: "filter.btime", from: "btimeFrom", to: "btimeTo" },
  { key: "addedAt", label: "filter.addedAt", from: "addedFrom", to: "addedTo" },
  {
    key: "playedAt",
    label: "filter.playedAt",
    from: "playedFrom",
    to: "playedTo",
  },
];

/** Unix seconds → the local "YYYY-MM-DD" a date input shows. */
export function toDateInput(sec: number | undefined): string {
  return sec == null ? "" : formatDay(new Date(sec * 1000));
}

/**
 * A date input's value → the first or the last second of that local day. The
 * same seconds a day picked on the heatmap is written as (daySeconds), so a
 * range typed here and one picked there are one condition: "23:59:59" would
 * stop an hour short on a day that daylight saving ends at midnight.
 */
export function fromDateInput(
  value: string,
  edge: "start" | "end",
): number | undefined {
  const date = parseDay(value);
  if (!date) return undefined;
  const [start, end] = daySeconds(date);
  return edge === "start" ? start : end;
}
