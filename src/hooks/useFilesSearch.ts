import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import {
  FILES_SEARCH_MAX_PAGES,
  FILES_SEARCH_PAGE_SIZE,
  filesSearchPreviousCursor,
  type FilesSearchPageParam,
} from "@/lib/filesSearch";

/** Windowed infinite search: only FILES_SEARCH_MAX_PAGES stay in the query cache. */
export function useFilesSearch(
  workspaceId: string | null | undefined,
  filter: SearchQuery,
  ready: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["files_search", workspaceId ?? null, filter],
    enabled: ready,
    initialPageParam: undefined as FilesSearchPageParam,
    queryFn: ({ pageParam }) =>
      api.filesSearch({
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
