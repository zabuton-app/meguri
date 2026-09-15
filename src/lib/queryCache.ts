// Targeted react-query cache updates for file metadata. Prefer patching over
// invalidating ["files_search"] so a favorite/rating toggle does not refetch
// the entire infinite list.
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
  WorkspacesList,
} from "@/ipc/types";
import { COLLECTION_ID_PREFIX } from "@/ipc/client";
import { WATCH_LATER_ID } from "@shared/workspaceIds";

/**
 * Query key prefix of the home landing's Recently added shelf (a plain FileRow[]
 * like the discovery queue). Declared here rather than imported from the route
 * so lib/ does not depend on routes/.
 */
export const HOME_RECENT_KEY = "home_recent";
/** Same for the landing's Picks for today shelf (deliberately not under
 *  ["files_random"]: the broad invalidations aimed at the discovery queue
 *  would otherwise redraw the day's sample). */
export const HOME_PICKS_KEY = "home_picks";
/** Same for the Recently played shelf (rows from the play history). */
export const HOME_PLAYED_KEY = "home_played";
/** Every Home shelf key: patched, dropped and removed together. */
const HOME_SHELF_KEYS = [HOME_RECENT_KEY, HOME_PICKS_KEY, HOME_PLAYED_KEY];

/** The SearchQuery part of a ["files_search", wsId, filter] query key. */
function searchFilterOf(queryKey: readonly unknown[]): SearchQuery | undefined {
  return queryKey[2] as SearchQuery | undefined;
}

function matchesFile(
  row: FileRow,
  workspaceId: string,
  fileId: number,
): boolean {
  return row.id === fileId && row.workspaceId === workspaceId;
}

/** Patch a file row across list/search caches (infinite search, discovery queue, home shelves). */
export function patchFileRowInCaches(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
  patch: Partial<FileRow>,
): void {
  qc.setQueriesData<InfiniteData<SearchResult>>(
    { queryKey: ["files_search"] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                matchesFile(item, workspaceId, fileId)
                  ? { ...item, ...patch }
                  : item,
              ),
            })),
          }
        : old,
  );
  const patchRows = (old: FileRow[] | undefined) =>
    old?.map((row) =>
      matchesFile(row, workspaceId, fileId) ? { ...row, ...patch } : row,
    );
  qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, patchRows);
  for (const key of HOME_SHELF_KEYS)
    qc.setQueriesData<FileRow[]>({ queryKey: [key] }, patchRows);
}

/** Drop a file row from the list/search caches (infinite search + discovery queue). */
export function removeFileRowFromCaches(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
): void {
  qc.setQueriesData<InfiniteData<SearchResult>>(
    { queryKey: ["files_search"] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter(
                (item) => !matchesFile(item, workspaceId, fileId),
              ),
            })),
          }
        : old,
  );
  const dropRow = (old: FileRow[] | undefined) =>
    old?.filter((row) => !matchesFile(row, workspaceId, fileId));
  qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, dropRow);
  for (const key of HOME_SHELF_KEYS)
    qc.setQueriesData<FileRow[]>({ queryKey: [key] }, dropRow);
}

/** Patch the detail cache when the modal is open for the same file. */
export function patchFileDetailInCache(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
  patch: Partial<FileDetail>,
): void {
  qc.setQueryData<FileDetail | null>(
    ["file_get", workspaceId, fileId],
    (old) => (old ? { ...old, ...patch } : old),
  );
}

/**
 * Drop every Home shelf's rows outright, after a workspace is removed: its
 * files may be on any of them. Removing rather than invalidating keeps the
 * day's picks from being redrawn for another reason than the removal itself.
 */
export function removeHomeShelves(qc: QueryClient): void {
  for (const key of HOME_SHELF_KEYS) qc.removeQueries({ queryKey: [key] });
}

/**
 * Refresh everything that lists the play history: the history screen and the
 * Home view's Recently played shelf. After clearing the history; a recorded
 * play reaches the same through invalidatePlayedSearches.
 */
export function invalidatePlayHistory(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["history_list"] });
  void qc.invalidateQueries({ queryKey: [HOME_PLAYED_KEY] });
}

/**
 * Invalidate only the searches affected by recording a play: a played/unplayed
 * filter (membership changes) or an "accessed" sort (recording bumps
 * last_accessed_at, so the order changes). Other lists keep their cache
 * instead of refetching every page.
 */
export function invalidatePlayedSearches(qc: QueryClient): void {
  // The Home view's Recently played shelf is the play history itself.
  void qc.invalidateQueries({ queryKey: [HOME_PLAYED_KEY] });
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      return filter?.played != null || filter?.sort === "accessed";
    },
  });
}

/**
 * Invalidate only the searches whose membership depends on tags: an explicit
 * tag filter, or a text query (FTS matches tag text). Row-level tag display is
 * kept in sync separately via patchFileRowInCaches.
 */
export function invalidateTagSearches(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      return Boolean(filter?.q || filter?.tags?.length);
    },
  });
}

/**
 * Invalidate everything that embeds tag names, after a catalog-level edit
 * (rename / merge / delete).
 *
 * Deliberately broader than invalidateTagSearches: tag names are denormalized
 * into every row's `tags[]`, so there is no row to patch — the name itself
 * changed. These edits are rare and explicitly user-initiated, so a wide
 * invalidation is the right trade.
 */
export function invalidateTagCatalog(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
  void qc.invalidateQueries({ queryKey: ["files_search"] });
  void qc.invalidateQueries({ queryKey: ["files_random"] });
  void qc.invalidateQueries({ queryKey: [HOME_RECENT_KEY] });
  void qc.invalidateQueries({ queryKey: [HOME_PLAYED_KEY] });
  void qc.invalidateQueries({ queryKey: ["file_get"] });
}

/**
 * Invalidate only the searches scoped to a user collection (membership changes
 * on add/remove-from-collection); regular workspace lists are unaffected.
 */
export function invalidateCollectionSearches(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => {
      const ws = q.queryKey[1];
      return typeof ws === "string" && ws.startsWith(COLLECTION_ID_PREFIX);
    },
  });
}

/** Sync favorite/rating (and other FileRow fields) across all file caches. */
export function syncFileRowAcrossCaches(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
  patch: Partial<FileRow>,
): void {
  patchFileRowInCaches(qc, workspaceId, fileId, patch);
  patchFileDetailInCache(qc, workspaceId, fileId, patch);
}

/**
 * Mirror the main process's `Workspaces.removeFromWatchLater()` into the cached
 * workspace list.
 *
 * Playing a file (in the player, as an image view, or in an external player)
 * takes it off Watch Later main-side, but that removal is deliberately silent:
 * broadcasting `workspace:changed` would refetch the list under an open detail
 * view and drop the viewed file out of the prev/next order. The detail view
 * flushes the caches on close instead — which leaves the toggle looking queued
 * for the rest of the visit.
 *
 * So patch the cache in place rather than invalidating it: `setQueryData` keeps
 * the refetch (and with it the navigation order) from happening at all.
 */
export function dropFromWatchLaterCache(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
): void {
  // Cancel first: a workspaces_list fetch already in flight would land after
  // this patch and restore the entry the main process has just consumed. The
  // detail view mounts its own observer for that key, so such a fetch is
  // routinely in the air when the play is recorded.
  //
  // Only when there is data to protect, though. Cancelling reverts the query to
  // its previous value, so cancelling a first-ever load strands this app-wide
  // key at undefined with nothing to re-run it (refetchOnWindowFocus is off) —
  // which would empty the workspace rail and freeze every Watch Later toggle in
  // its disabled state. With no data the patch below is a no-op anyway.
  if (qc.getQueryData(["workspaces_list"]) !== undefined) {
    void qc.cancelQueries({ queryKey: ["workspaces_list"] });
  }
  qc.setQueryData<WorkspacesList>(["workspaces_list"], (prev) => {
    if (!prev) return prev;
    const watchLater = prev.collections.find((c) => c.id === WATCH_LATER_ID);
    if (!watchLater) return prev;
    const items = watchLater.items.filter(
      (item) => item.workspaceId !== workspaceId || item.fileId !== fileId,
    );
    // Same object identity when nothing matched, so no observer re-renders.
    if (items.length === watchLater.items.length) return prev;
    return {
      ...prev,
      collections: prev.collections.map((c) =>
        c.id === WATCH_LATER_ID ? { ...c, items } : c,
      ),
    };
  });
}
