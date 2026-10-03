// What the playlist and Discovery draw from while browsing by folder.
//
// The list shows a folder's direct files, but both ways of watching take the
// folder's whole subtree: Discovery through its filter (`subtreeFilter`), the
// player through an order of its own (`playlistNav`, served to it through
// PlaylistNavContext). The order is fetched only while the player — or the
// detail view the player detoured to — is open.
import { useCallback, useMemo } from "react";
import type { MediaNav } from "@/components/MediaNavContext";
import { useFilesSearch } from "@/hooks/useFilesSearch";
import { filesSearchListOffset } from "@/lib/filesSearch";
import type { SearchQuery } from "@/ipc/types";

export function useFolderPlaylist({
  workspaceId,
  ready,
  filter,
  folderView,
  path,
  browsing,
  playing,
}: {
  workspaceId: string | null | undefined;
  ready: boolean;
  filter: SearchQuery;
  /** Shown by folder at all (browsing or searching inside a folder). */
  folderView: boolean;
  path: string;
  /** Browsing the folder's own contents (no search): the list is not the pool. */
  browsing: boolean;
  /** The player, or the detail view it detoured to, is open. */
  playing: boolean;
}): { subtreeFilter: SearchQuery; playlistNav: MediaNav | null } {
  // Everything below the folder. For the root that is the whole workspace, so
  // the scope narrows nothing there — it is kept anyway, so Discovery can say
  // which folder it draws from even at the root.
  const subtreeFilter = useMemo<SearchQuery>(
    () =>
      folderView ? { ...filter, folder: { path, recursive: true } } : filter,
    [filter, folderView, path],
  );

  // Searching, the list already is the pool and the player plays it as shown.
  // Browsing, it plays the subtree in the list's chosen sort — by name when
  // none is chosen, which plays folder by folder.
  const playlistQuery = useMemo<SearchQuery | null>(
    () =>
      browsing
        ? {
            ...subtreeFilter,
            // A lone direction is a chosen sort too (the "added" order).
            ...(filter.sort || filter.sortDir
              ? {}
              : { sort: "name", sortDir: "asc" as const }),
          }
        : null,
    [browsing, subtreeFilter, filter.sort, filter.sortDir],
  );
  const search = useFilesSearch(
    workspaceId,
    playlistQuery ?? {},
    ready && playlistQuery != null && playing,
  );
  const items = useMemo(
    () => search.data?.pages.flatMap((p) => p.items) ?? [],
    [search.data],
  );
  const fetchNextPage = useCallback(() => {
    void search.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.fetchNextPage]);
  const fetchPreviousPage = useCallback(() => {
    void search.fetchPreviousPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.fetchPreviousPage]);

  const playlistNav = useMemo<MediaNav | null>(
    () =>
      playlistQuery
        ? {
            items,
            listOffset: filesSearchListOffset(search.data?.pageParams),
            fetchNextPage,
            hasNextPage: search.hasNextPage,
            isFetchingNextPage: search.isFetchingNextPage,
            fetchPreviousPage,
            hasPreviousPage: search.hasPreviousPage,
            isFetchingPreviousPage: search.isFetchingPreviousPage,
            isLoading: search.isLoading || (playing && !search.data),
            folder: path,
          }
        : null,
    [
      playlistQuery,
      items,
      search.data,
      fetchNextPage,
      search.hasNextPage,
      search.isFetchingNextPage,
      fetchPreviousPage,
      search.hasPreviousPage,
      search.isFetchingPreviousPage,
      search.isLoading,
      playing,
      path,
    ],
  );
  return { subtreeFilter, playlistNav };
}
