// The timeline's rows, worked out from the day counts alone: every section
// is a header row followed by its files packed `cols` to a row. Nothing here
// needs the files themselves, so the whole height is known before any of them
// is read and a day can be scrolled to that has not been loaded.
import type { TimelineCounts } from "@shared/ipc/timeline";
import type { GridNavDirection } from "@/hooks/useGridKeyboardNav";

/** The key of the section holding the files with no date on the axis. */
export const UNDATED = "undated";

export interface TimelineSection {
  /** "YYYY-MM-DD", or UNDATED for the tail. */
  key: string;
  count: number;
  /** Index, in the whole list, of the section's first file. */
  start: number;
  /** Row of the section's header; its files follow from the next row. */
  headerRow: number;
  /** Rows of files under the header. */
  rows: number;
}

export interface TimelineLayout {
  sections: TimelineSection[];
  cols: number;
  /** Header and file rows together. */
  rowCount: number;
  /** Files in the whole list. */
  total: number;
}

export type TimelineRow =
  | { kind: "header"; section: TimelineSection }
  | {
      kind: "cards";
      section: TimelineSection;
      /** Index, in the whole list, of the row's first file. */
      first: number;
      /** Files in the row (fewer than `cols` on a section's last row). */
      length: number;
    };

export function buildLayout(
  counts: TimelineCounts | undefined,
  cols: number,
): TimelineLayout {
  const perRow = Math.max(1, cols);
  const sections: TimelineSection[] = [];
  let start = 0;
  let row = 0;
  const push = (key: string, count: number) => {
    if (count <= 0) return;
    const rows = Math.ceil(count / perRow);
    sections.push({ key, count, start, headerRow: row, rows });
    start += count;
    row += 1 + rows;
  };
  for (const d of counts?.days ?? []) push(d.day, d.count);
  push(UNDATED, counts?.undated ?? 0);
  return { sections, cols: perRow, rowCount: row, total: start };
}

/** Index of the last section whose `field` is at or before `value`; -1 for none. */
function lastAtOrBefore(
  sections: TimelineSection[],
  field: "start" | "headerRow",
  value: number,
): number {
  let lo = 0;
  let hi = sections.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid][field] <= value) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The section a row belongs to (its header or its files). */
export function sectionOfRow(
  layout: TimelineLayout,
  row: number,
): TimelineSection | null {
  if (row < 0 || row >= layout.rowCount) return null;
  return layout.sections[lastAtOrBefore(layout.sections, "headerRow", row)];
}

/** The section holding the file at `index` of the whole list. */
export function sectionOfIndex(
  layout: TimelineLayout,
  index: number,
): TimelineSection | null {
  if (index < 0 || index >= layout.total) return null;
  return layout.sections[lastAtOrBefore(layout.sections, "start", index)];
}

export function rowAt(layout: TimelineLayout, row: number): TimelineRow | null {
  const section = sectionOfRow(layout, row);
  if (!section) return null;
  if (row === section.headerRow) return { kind: "header", section };
  const offset = (row - section.headerRow - 1) * layout.cols;
  return {
    kind: "cards",
    section,
    first: section.start + offset,
    length: Math.min(layout.cols, section.count - offset),
  };
}

/** The row the file at `index` is drawn in; -1 outside the list. */
export function rowOfIndex(layout: TimelineLayout, index: number): number {
  const section = sectionOfIndex(layout, index);
  if (!section) return -1;
  return (
    section.headerRow + 1 + Math.floor((index - section.start) / layout.cols)
  );
}

export type StepDirection = GridNavDirection;

/**
 * Where keyboard focus goes from the file at `index`. Left and right walk the
 * list; up and down keep the column, across sections, and land on the last
 * file of a row too short to have that column.
 */
export function stepIndex(
  layout: TimelineLayout,
  index: number,
  direction: StepDirection,
): number {
  if (layout.total === 0) return -1;
  if (direction === "left") return Math.max(0, index - 1);
  if (direction === "right") return Math.min(layout.total - 1, index + 1);
  const section = sectionOfIndex(layout, index);
  if (!section) return Math.min(Math.max(index, 0), layout.total - 1);
  const col = (index - section.start) % layout.cols;
  const fileRow = Math.floor((index - section.start) / layout.cols);
  const at = (s: TimelineSection, r: number) =>
    s.start + Math.min(r * layout.cols + col, s.count - 1);
  const i = layout.sections.indexOf(section);
  if (direction === "down") {
    if (fileRow + 1 < section.rows) return at(section, fileRow + 1);
    const next = layout.sections[i + 1];
    return next ? at(next, 0) : index;
  }
  if (fileRow > 0) return at(section, fileRow - 1);
  const prev = layout.sections[i - 1];
  return prev ? at(prev, prev.rows - 1) : index;
}
