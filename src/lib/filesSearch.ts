// Shared settings for the infinite files_search query. maxPages keeps only a
// sliding window of pages in the react-query cache instead of every fetched page.
export const FILES_SEARCH_PAGE_SIZE = 100;
export const FILES_SEARCH_MAX_PAGES = 5;

/** Cursor for the page before the first loaded page, or undefined at offset 0. */
export function filesSearchPreviousCursor(
  firstPageParam: number | undefined,
): number | undefined {
  const offset = firstPageParam ?? 0;
  if (offset <= 0) return undefined;
  return offset - FILES_SEARCH_PAGE_SIZE;
}

/** Offset (0-based item index) of the first cached search page. */
export function filesSearchListOffset(
  pageParams: readonly unknown[] | undefined,
): number {
  const first = pageParams?.[0];
  return typeof first === "number" ? first : 0;
}
