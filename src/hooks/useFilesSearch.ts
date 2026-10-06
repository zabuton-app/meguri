import { useInfiniteQuery } from "@tanstack/react-query";
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
 * is opened away from the top. Built here alone, so the cache helpers that
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
  });
}
