// Targeted react-query cache updates for file metadata. Prefer patching over
// invalidating ["files_search"] so a favorite/rating toggle does not refetch
// the entire infinite list.
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
} from "@/ipc/types";
import { COLLECTION_ID_PREFIX } from "@/ipc/client";

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
