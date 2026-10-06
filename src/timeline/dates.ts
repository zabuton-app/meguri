// The timeline's dates: how a day or a month is named, and how a file's date
// becomes the key of its section and of its mark on the rail.
import type { FileRow } from "@/ipc/types";
import type { TimelineAxis } from "@shared/ipc/timeline";
import { formatDay, parseDay } from "@shared/day";
import { UNDATED } from "./layout";
import { parseMonth } from "./month";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(lang: string, withDay: boolean): Intl.DateTimeFormat {
  const key = `${lang}|${withDay}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, {
      year: "numeric",
      month: "long",
      ...(withDay ? { day: "numeric" } : {}),
    });
    formatters.set(key, format);
  }
  return format;
}

/**
 * A "YYYY-MM" month in the words of a language ("October 2026", "2026年10月"):
 * the order of year and month is the language's own, which a translated
 * pattern would have to restate for each one.
 */
export function monthLabel(month: string, lang: string): string {
  const date = parseMonth(month);
  return date ? formatter(lang, false).format(date) : month;
}

/** A "YYYY-MM-DD" day in the words of a language ("October 6, 2026"). */
export function dayLabel(day: string, lang: string): string {
  const date = parseDay(day);
  return date ? formatter(lang, true).format(date) : day;
}

/**
 * The section a file belongs in, by its own date on the axis (the renderer's
 * side of the main process's AXIS_EXPR).
 */
export function sectionKeyOf(file: FileRow, axis: TimelineAxis): string {
  const ts =
    axis === "captured"
      ? file.capturedAt
      : axis === "btime"
        ? file.btime
        : file.addedAt;
  return ts == null ? UNDATED : formatDay(new Date(ts * 1000));
}

/** The month a "YYYY-MM-DD" day is in. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The rail's key for a section: its month, or the undated tail itself. */
export function railKeyOf(sectionKey: string): string {
  return sectionKey === UNDATED ? UNDATED : monthOf(sectionKey);
}

/** The year of a "YYYY-MM" month. */
export function yearOf(month: string): string {
  return month.slice(0, 4);
}
