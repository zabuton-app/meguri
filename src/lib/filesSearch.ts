// Shared settings for the infinite files_search query. maxPages keeps only a
// sliding window of pages in the react-query cache instead of every fetched page.
import type { SearchCursor } from "@/ipc/types";

export const FILES_SEARCH_PAGE_SIZE = 100;
export const FILES_SEARCH_MAX_PAGES = 5;

/**
 * A backward page shorter than a full one: the rows from the top of the list
 * down to a window that does not start on a page boundary (one opened at a
 * cursor of its own, see useFilesSearch's `anchor`).
 */
export interface FilesSearchHeadPage {
  offset: 0;
  size: number;
}

/** Page params are cursors: keyset objects from the main process, plain
 *  offsets for backward pages, undefined for the very first page. */
export type FilesSearchPageParam =
  number | SearchCursor | FilesSearchHeadPage | undefined;

export function isHeadPage(
  param: FilesSearchPageParam,
): param is FilesSearchHeadPage {
  return typeof param === "object" && param !== null && "size" in param;
}

/** Offset carried by a cursor (keyset cursors piggyback it for the UI). */
function offsetOf(cursor: FilesSearchPageParam): number {
  if (cursor == null) return 0;
  return typeof cursor === "number" ? cursor : cursor.offset;
}

/**
 * Cursor for the page before the first loaded page, or undefined at offset 0.
 * Backward pages use an offset-only cursor (no seek key): the main process
 * falls back to OFFSET scanning for them, which is fine for the rare
 * scroll-up-past-the-window case — forward infinite scroll is the hot path.
 */
export function filesSearchPreviousCursor(
  firstPageParam: FilesSearchPageParam,
): number | FilesSearchHeadPage | undefined {
  const offset = offsetOf(firstPageParam);
  if (offset <= 0) return undefined;
  // Less than a page left above the window: a full page from the top would
  // run into the rows already loaded.
  if (offset < FILES_SEARCH_PAGE_SIZE) return { offset: 0, size: offset };
  return offset - FILES_SEARCH_PAGE_SIZE;
}

/** Offset (0-based item index) of the first cached search page. */
export function filesSearchListOffset(
  pageParams: readonly unknown[] | undefined,
): number {
  const first = pageParams?.[0];
  if (typeof first === "number") return first;
  if (first && typeof first === "object" && "offset" in first) {
    const offset = (first as SearchCursor).offset;
    return typeof offset === "number" ? Math.max(0, offset) : 0;
  }
  return 0;
}
