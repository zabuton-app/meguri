// Where the list is read from after the view has moved away from the pages
// loaded: the cursor files_search starts the new window at.
import { daySeconds, parseDay } from "@shared/day";
import {
  FILES_SEARCH_PAGE_SIZE,
  type FilesSearchPageParam,
} from "@/lib/filesSearch";
import { sectionOfIndex, UNDATED, type TimelineLayout } from "./layout";

/** How far into a section a view may be and still be read from its head. */
const HEAD_REACH = FILES_SEARCH_PAGE_SIZE / 2;

/**
 * The cursor for a window that shows the file at `index` of the whole list.
 *
 * Near the head of a section — where the rail lands — it is a keyed
 * cursor: the section's last second (the list runs newest first), with a
 * workspace id that sorts before every real one so no file dated on that very
 * second is skipped. The main process seeks straight to it, however deep the
 * section is. Deeper into a section there is no key to give without the rows
 * before it, so the cursor is a page-aligned offset, read by skipping.
 */
export function anchorFor(
  layout: TimelineLayout,
  index: number,
): FilesSearchPageParam {
  const section = sectionOfIndex(layout, index);
  if (!section || index < HEAD_REACH) return undefined;
  if (index - section.start < HEAD_REACH) {
    if (section.start === 0) return undefined;
    const start = section.key === UNDATED ? null : parseDay(section.key);
    return {
      offset: section.start,
      key: { v: start ? daySeconds(start)[1] : null, ws: "", id: 0 },
    };
  }
  return Math.floor(index / FILES_SEARCH_PAGE_SIZE) * FILES_SEARCH_PAGE_SIZE;
}

/** Whether two cursors start the same window. */
export function sameAnchor(
  a: FilesSearchPageParam,
  b: FilesSearchPageParam,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
