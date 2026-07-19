import type { SearchQuery } from "@/ipc/types";

/**
 * Query patch toggling the duplicates filter. Enabling also selects the hash
 * sort explicitly (visible in the sort dropdown) so copies list adjacently;
 * disabling keeps the current sort unless it's still the auto-selected hash
 * sort, in which case it falls back to the default sort.
 * Shared by the FilterBar toggle and the active-filter chip so both paths
 * stay symmetric.
 */
export function toggleDuplicatesPatch(query: SearchQuery): Partial<SearchQuery> {
  if (query.duplicates) {
    return {
      duplicates: undefined,
      ...(query.sort === "hash"
        ? { sort: undefined, sortDir: undefined }
        : {}),
    };
  }
  return { duplicates: true, sort: "hash", sortDir: undefined };
}
