// Targeted react-query cache updates for file metadata. Prefer patching over
// invalidating ["files_search"] so a favorite/rating toggle does not refetch
// the entire infinite list.
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
  UserCollectionItem,
  WorkspacesList,
} from "@/ipc/types";
import { COLLECTION_ID_PREFIX } from "@/ipc/client";
import { WATCH_LATER_ID, collectionTarget } from "@shared/workspaceIds";
import {
  parseNegatedSearchToken,
  parseSearchDirective,
  splitSearchTokens,
} from "@shared/tags";

/**
 * The SearchQuery part of a ["files_search", wsId, filter] query key. The
 * graph ("graph_build"), the heatmap ("activity_days") and the timeline's
 * day counts ("timeline_counts") keep the scope and the filter in the same two
 * places.
 */
function searchFilterOf(queryKey: readonly unknown[]): SearchQuery | undefined {
  return queryKey[2] as SearchQuery | undefined;
}

/** The metric of an ["activity_days", scope, filter, metric, from, to] key. */
function activityMetricOf(queryKey: readonly unknown[]): unknown {
  return queryKey[3];
}

function matchesFile(
  row: FileRow,
  workspaceId: string,
  fileId: number,
): boolean {
  return row.id === fileId && row.workspaceId === workspaceId;
}

/**
 * The file's content hash, from whichever cache holds it (its detail, a list,
 * the Discover queue); null when none does or the file has none yet.
 */
function contentHashOf(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
): string | null {
  const detail = qc.getQueryData<FileDetail | null>([
    "file_get",
    workspaceId,
    fileId,
  ]);
  if (detail) return detail.contentHash ?? null;
  for (const [, data] of qc.getQueriesData<InfiniteData<SearchResult>>({
    queryKey: ["files_search"],
  })) {
    for (const page of data?.pages ?? []) {
      const row = page.items.find((r) => matchesFile(r, workspaceId, fileId));
      if (row) return row.contentHash ?? null;
    }
  }
  for (const [, rows] of qc.getQueriesData<FileRow[]>({
    queryKey: ["files_random"],
  })) {
    const row = rows?.find((r) => matchesFile(r, workspaceId, fileId));
    if (row) return row.contentHash ?? null;
  }
  return null;
}

/**
 * Patch a file row across list/search caches (infinite search + discovery
 * queue). What these patches carry — favorite, rating, tags, the resume
 * position, bookmarks — is kept per content (meta_key), so the rows of the
 * file's other copies (same content hash, in any workspace) are patched too.
 * A file without a hash keys its metadata by path and shares it with none.
 */
export function patchFileRowInCaches(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
  patch: Partial<FileRow>,
): void {
  const contentHash = contentHashOf(qc, workspaceId, fileId);
  const matches = (row: FileRow) =>
    matchesFile(row, workspaceId, fileId) ||
    (contentHash != null && row.contentHash === contentHash);
  qc.setQueriesData<InfiniteData<SearchResult>>(
    { queryKey: ["files_search"] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                matches(item) ? { ...item, ...patch } : item,
              ),
            })),
          }
        : old,
  );
  qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, (old) =>
    old?.map((row) => (matches(row) ? { ...row, ...patch } : row)),
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
 * it), the history timeline, the duplicate groups (both of which leave
 * deleted rows out) and the graph are re-read.
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
  void qc.invalidateQueries({ queryKey: ["graph_build"] });
  void qc.invalidateQueries({ queryKey: ["activity_days"] });
  void qc.invalidateQueries({ queryKey: ["timeline_counts"] });
}

/** Patch the detail cache of the file, and of its copies, wherever one is held. */
export function patchFileDetailInCache(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
  patch: Partial<FileDetail>,
): void {
  // Per content, as patchFileRowInCaches: the copies' details as well.
  const contentHash = contentHashOf(qc, workspaceId, fileId);
  for (const [key, old] of qc.getQueriesData<FileDetail | null>({
    queryKey: ["file_get"],
  })) {
    if (!old) continue;
    const self = key[1] === workspaceId && key[2] === fileId;
    if (self || (contentHash != null && old.contentHash === contentHash))
      qc.setQueryData<FileDetail | null>(key, { ...old, ...patch });
  }
}

/** Marks a graph query whose nodes are sized by plays (see useGraphData). */
export const GRAPH_SIZED_BY_PLAYS = "sizedByPlays";

/**
 * Invalidate only what recording a play affects: a played/unplayed filter
 * (membership changes) or an "accessed" sort (recording bumps
 * last_accessed_at, so the order changes), in the list and the graph, a graph
 * that sizes nodes by plays, and the Watch Later graph (a play consumes the
 * file from Watch Later; the list's membership is patched by
 * dropFromWatchLaterCache). Other lists keep their cache instead of refetching
 * every page.
 */
/** Whether recording a play can change which files a filter matches. */
function filtersOnPlays(filter: SearchQuery | undefined): boolean {
  return (
    filter?.played != null ||
    filter?.playedFrom != null ||
    filter?.playedTo != null
  );
}

export function invalidatePlayedSearches(qc: QueryClient): void {
  const watchLater = collectionTarget(WATCH_LATER_ID);
  void qc.invalidateQueries({
    queryKey: ["graph_build"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      return (
        q.queryKey[1] === watchLater ||
        q.meta?.[GRAPH_SIZED_BY_PLAYS] === true ||
        filtersOnPlays(filter) ||
        filter?.sort === "accessed"
      );
    },
  });
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      return filtersOnPlays(filter) || filter?.sort === "accessed";
    },
  });
  // The heatmap counting plays, or files by whether they were played, and
  // any heatmap of Watch Later.
  void qc.invalidateQueries({
    queryKey: ["activity_days"],
    predicate: (q) =>
      // A play takes the file off Watch Later, whatever is counted there.
      q.queryKey[1] === watchLater ||
      activityMetricOf(q.queryKey) === "played" ||
      filtersOnPlays(searchFilterOf(q.queryKey)),
  });
  // The timeline's day counts of the same lists (its axes are not plays).
  void qc.invalidateQueries({
    queryKey: ["timeline_counts"],
    predicate: (q) =>
      q.queryKey[1] === watchLater ||
      filtersOnPlays(searchFilterOf(q.queryKey)),
  });
}

/**
 * Invalidate only the searches filtered on "In progress", in the list and the
 * graph: saving where a file was left can add it to them or (played to the
 * end) take it out.
 */
export function invalidateInProgressSearches(qc: QueryClient): void {
  const inProgress = (q: { queryKey: readonly unknown[] }) =>
    searchFilterOf(q.queryKey)?.inProgress === true;
  void qc.invalidateQueries({
    queryKey: ["graph_build"],
    predicate: inProgress,
  });
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: inProgress,
  });
  void qc.invalidateQueries({
    queryKey: ["activity_days"],
    predicate: inProgress,
  });
  void qc.invalidateQueries({
    queryKey: ["timeline_counts"],
    predicate: inProgress,
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
  const byTags = (q: { queryKey: readonly unknown[] }) => {
    const filter = searchFilterOf(q.queryKey);
    return Boolean(filter?.q || filter?.tags?.length);
  };
  void qc.invalidateQueries({ queryKey: ["files_search"], predicate: byTags });
  void qc.invalidateQueries({ queryKey: ["activity_days"], predicate: byTags });
  void qc.invalidateQueries({
    queryKey: ["timeline_counts"],
    predicate: byTags,
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
  void qc.invalidateQueries({ queryKey: ["activity_days"] });
  void qc.invalidateQueries({ queryKey: ["timeline_counts"] });
  void qc.invalidateQueries({ queryKey: ["files_search"] });
  void qc.invalidateQueries({ queryKey: ["files_random"] });
  void qc.invalidateQueries({ queryKey: ["file_get"] });
  // Its groups carry file rows too (their resume progress, among others).
  void qc.invalidateQueries({ queryKey: ["duplicates_list"] });
}

/**
 * After a scan exclusion hid files (#282): they leave the lists as a file
 * removed from the index does, from the folder cards (their counts and
 * mosaics), the history and Missing too.
 */
export function invalidateHiddenFiles(qc: QueryClient): void {
  invalidateFileCaches(qc);
  void qc.invalidateQueries({ queryKey: ["folders_list"] });
  void qc.invalidateQueries({ queryKey: ["history_list"] });
  void qc.invalidateQueries({ queryKey: ["missing_files"] });
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
  const inCollection = (q: { queryKey: readonly unknown[] }) => {
    const ws = q.queryKey[1];
    return typeof ws === "string" && ws.startsWith(COLLECTION_ID_PREFIX);
  };
  void qc.invalidateQueries({
    queryKey: ["files_search"],
    predicate: inCollection,
  });
  void qc.invalidateQueries({
    queryKey: ["activity_days"],
    predicate: inCollection,
  });
  void qc.invalidateQueries({
    queryKey: ["timeline_counts"],
    predicate: inCollection,
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
  // The graph has no rows to patch: rebuild one this change can reshape.
  void qc.invalidateQueries({
    queryKey: ["graph_build"],
    predicate: (q) => {
      const filter = searchFilterOf(q.queryKey);
      // The box's `is:fav` and `rating:` filter as the controls do (#525),
      // excluded (`-is:fav`) or not.
      const kinds = new Set(
        splitSearchTokens(filter?.q ?? "").map(
          (token) =>
            parseSearchDirective(parseNegatedSearchToken(token).body)?.kind,
        ),
      );
      return (
        ("favorite" in patch &&
          (filter?.favorite != null || kinds.has("favorite"))) ||
        ("rating" in patch &&
          (filter?.ratingMin != null ||
            filter?.sort === "rating" ||
            kinds.has("rating")))
      );
    },
  });
  // The heatmap is left as it is, like the list under it: a row that no
  // longer matches a favorite or rating filter stays until the list is read
  // again, and a recount alone would make a cell disagree with its list.
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
 * the refetch (and with it the navigation order) from happening at all. If a
 * refetch had already invalidated the key, preserve that invalidation so its
 * newer data can be picked up on the next mount.
 */
export function dropFromWatchLaterCache(
  qc: QueryClient,
  workspaceId: string,
  fileId: number,
): void {
  const queryKey = ["workspaces_list"] as const;
  const wasInvalidated = qc.getQueryState(queryKey)?.isInvalidated ?? false;
  // Cancel first: a workspaces_list fetch already in flight would land after
  // this patch and restore the entry the main process has just consumed. A
  // refetch started by some other invalidation (the detail view's flush on
  // close, a collection edit) can be in the air when the play is recorded.
  //
  // Only when there is data to protect, though. Cancelling reverts the query to
  // its previous value, so cancelling a first-ever load strands this app-wide
  // key at undefined with nothing to re-run it (refetchOnWindowFocus is off) —
  // which would empty the workspace rail and freeze every Watch Later toggle in
  // its disabled state. With no data the patch below is a no-op anyway.
  if (qc.getQueryData(queryKey) !== undefined) {
    void qc.cancelQueries({ queryKey });
  }
  qc.setQueryData<WorkspacesList>(queryKey, (prev) => {
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
  if (wasInvalidated) {
    void qc.invalidateQueries({ queryKey, refetchType: "none" });
  }
}

/** Optimistically mirror a manual reorder into the cached collection order. */
export function patchCollectionItemOrder(
  qc: QueryClient,
  collectionId: string,
  order: { workspaceId: string; fileId: number }[],
): void {
  const queryKey = ["workspaces_list"] as const;
  const wasInvalidated = qc.getQueryState(queryKey)?.isInvalidated ?? false;
  const key = (item: { workspaceId: string; fileId: number }) =>
    `${item.workspaceId}:${item.fileId}`;

  // Cancel first, as in dropFromWatchLaterCache: a fetch already in flight
  // carries the old order, and a reorder is not broadcast to correct it.
  if (qc.getQueryData(queryKey) !== undefined) {
    void qc.cancelQueries({ queryKey });
  }
  qc.setQueryData<WorkspacesList>(queryKey, (prev) => {
    if (!prev) return prev;
    const collection = prev.collections.find(
      (item) => item.id === collectionId,
    );
    if (!collection || order.length === 0) return prev;

    const byKey = new Map(collection.items.map((item) => [key(item), item]));
    const moving: UserCollectionItem[] = [];
    const movedKeys = new Set<string>();
    for (const ref of order) {
      const itemKey = key(ref);
      if (movedKeys.has(itemKey)) continue;
      const item = byKey.get(itemKey);
      if (!item) continue;
      movedKeys.add(itemKey);
      moving.push(item);
    }
    if (moving.length === 0) return prev;

    let at = 0;
    const items = collection.items.map((item) =>
      movedKeys.has(key(item)) ? moving[at++] : item,
    );
    return {
      ...prev,
      collections: prev.collections.map((item) =>
        item.id === collectionId ? { ...item, items } : item,
      ),
    };
  });
  if (wasInvalidated) {
    void qc.invalidateQueries({ queryKey, refetchType: "none" });
  }
}
