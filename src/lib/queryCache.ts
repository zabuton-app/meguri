// Targeted react-query cache updates for file metadata. Prefer patching over
// invalidating ["files_search"] so a favorite/rating toggle does not refetch
// the entire infinite list.
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { FileDetail, FileRow, SearchResult } from "@/ipc/types";

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
