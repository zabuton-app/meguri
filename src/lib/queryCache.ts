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

/** Patch a file row across list/search caches (infinite search + discovery queue). */
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
  qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, (old) =>
    old?.map((row) =>
      matchesFile(row, workspaceId, fileId) ? { ...row, ...patch } : row,
    ),
  );
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
  qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, (old) =>
    old?.filter((row) => !matchesFile(row, workspaceId, fileId)),
  );
}

/**
 * Everything the renderer caches about a file that has just been dropped from
 * the index: its list rows go at once, its detail is forgotten, and the
 * searches, the discovery queue, its workspace's folder listings (whose
 * counts and mosaics include it, and whose last file can take a folder with
 * it), the history timeline and the duplicate groups (both of which leave
 * deleted rows out) are re-read.
 */
export function forgetDeletedFile(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
): void {
  removeFileRowFromCaches(qc, workspaceId, fileId);
  qc.removeQueries({ queryKey: ["file_get", workspaceId, fileId] });
  void qc.invalidateQueries({ queryKey: ["files_search"] });
  void qc.invalidateQueries({ queryKey: ["files_random"] });
  void qc.invalidateQueries({ queryKey: ["folders_list", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["history_list"] });
  void qc.invalidateQueries({ queryKey: ["duplicates_list"] });
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
 * Invalidate only the searches affected by recording a play: a played/unplayed
 * filter (membership changes) or an "accessed" sort (recording bumps
 * last_accessed_at, so the order changes). Other lists keep their cache
 * instead of refetching every page.
 */
export function invalidatePlayedSearches(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      return filter?.played != null || filter?.sort === "accessed";
    },
  });
}

/**
 * Invalidate only the searches filtered on "In progress": saving where a file
 * was left can add it to them or (played to the end) take it out.
 */
export function invalidateInProgressSearches(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => searchFilterOf(q.queryKey)?.inProgress === true,
  });
}

/**
 * Invalidate only the searches whose membership depends on tags: an explicit
 * tag filter, or a text query (FTS matches tag text). Row-level tag display is
 * kept in sync separately via patchFileRowInCaches.
 */
export function invalidateTagSearches(qc: QueryClient): void {
  // The graph is drawn from tags whatever the filter, so it always goes.
  void qc.invalidateQueries({ queryKey: ["graph_build"] });
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
 * (rename / merge / delete) or a bulk edit over a selection.
 *
 * Deliberately broader than invalidateTagSearches: tag names are denormalized
 * into every row's `tags[]`, so there is no row to patch — either the name
 * itself changed, or (for a bulk edit) the write returns counters rather than
 * the rows it touched. These edits are rare and explicitly user-initiated, so a
 * wide invalidation is the right trade.
 */
export function invalidateTagCatalog(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
  invalidateFileCaches(qc);
}

/**
 * Re-read every cached view of the files themselves.
 *
 * For a write whose full effect the renderer cannot predict from the result. A
 * bulk metadata edit is the case this exists for: the main process writes by
 * `meta_key`, so a file sharing a content hash with a selected one changes too
 * and is not in the selection to patch; and a file whose row had already gone
 * comes back only as a `skipped` count, without saying which. Patching what is
 * known keeps the response instant, and this reconciles the rest.
 */
export function invalidateFileCaches(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["graph_build"] });
  void qc.invalidateQueries({ queryKey: ["files_search"] });
  void qc.invalidateQueries({ queryKey: ["files_random"] });
  void qc.invalidateQueries({ queryKey: ["file_get"] });
  // Its groups carry file rows too (their resume progress, among others).
  void qc.invalidateQueries({ queryKey: ["duplicates_list"] });
}

/**
 * Invalidate only the searches scoped to a user collection (membership changes
 * on add/remove-from-collection); regular workspace lists are unaffected.
 */
export function invalidateCollectionSearches(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ["graph_build"],
    predicate: (q) => {
      const scope = q.queryKey[1];
      return (
        typeof scope === "string" && scope.startsWith(COLLECTION_ID_PREFIX)
      );
    },
  });
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
