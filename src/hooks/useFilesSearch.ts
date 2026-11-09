import { hashKey, useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import {
  FILES_SEARCH_MAX_PAGES,
  FILES_SEARCH_PAGE_SIZE,
  filesSearchPreviousCursor,
  isHeadPage,
  type FilesSearchPageParam,
} from "@/lib/filesSearch";

/**
 * The query key of a list: scope and filter, then the anchor when the window
 * is opened away from the top. (useFilesSearch's placeholderData reads it back
 * in this order.) Built here alone, so the cache helpers that
 * reset a list find it where the hook keeps it.
 */
export function filesSearchKey(
  workspaceId: string | null | undefined,
  filter: SearchQuery,
  anchor?: FilesSearchPageParam,
): readonly unknown[] {
  return anchor === undefined
    ? ["files_search", workspaceId ?? null, filter]
    : ["files_search", workspaceId ?? null, filter, anchor];
}

/** Whether two filters differ in their free text alone. */
function sameButText(a: SearchQuery, b: SearchQuery): boolean {
  return (
    hashKey([{ ...a, q: undefined }]) === hashKey([{ ...b, q: undefined }])
  );
}

/**
 * Windowed infinite search: only FILES_SEARCH_MAX_PAGES stay in the query cache.
 *
 * `anchor` opens the window somewhere other than the top of the list (the
 * timeline jumping to a month): the cursor of its first page. Each anchor is a
 * query of its own, after the scope and the filter in the key so the cache
 * helpers that read those two find them where they always are.
 */
export function useFilesSearch(
  workspaceId: string | null | undefined,
  filter: SearchQuery,
  ready: boolean,
  anchor?: FilesSearchPageParam,
  /**
   * While the search text changes and nothing else does, keep showing the
   * previous results until the new ones arrive (`isPlaceholderData`) instead
   * of dropping back to the loading state: otherwise every keystroke tears the
   * list down to skeletons and mounts it again. Any other change (scope,
   * filter, sort, anchor) still starts from loading, so the view never shows
   * another list's rows under a different order or workspace.
   * The caller must not page while `isPlaceholderData` is set: the pages on
   * screen belong to the other query.
   */
  keepWhileTyping = false,
) {
  return useInfiniteQuery({
    queryKey: filesSearchKey(workspaceId, filter, anchor),
    enabled: ready,
    initialPageParam: anchor,
    queryFn: ({ pageParam }) =>
      isHeadPage(pageParam)
        ? api.filesSearch({ ...filter, cursor: 0, limit: pageParam.size })
        : api.filesSearch({
            ...filter,
            cursor: pageParam,
            limit: FILES_SEARCH_PAGE_SIZE,
          }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    getPreviousPageParam: (_first, _all, firstPageParam) =>
      filesSearchPreviousCursor(firstPageParam),
    maxPages: FILES_SEARCH_MAX_PAGES,
    placeholderData: keepWhileTyping
      ? (previous, previousQuery) => {
          if (!previous || !previousQuery || anchor !== undefined) return;
          const [, prevScope, prevFilter, prevAnchor] = previousQuery.queryKey;
          return prevScope === (workspaceId ?? null) &&
            prevAnchor === undefined &&
            sameButText(prevFilter as SearchQuery, filter)
            ? previous
            : undefined;
        }
      : undefined,
  });
}
