import type { SearchQuery } from "@/ipc/types";

/**
 * Query patch toggling the duplicates filter. Enabling also selects the hash
 * sort explicitly (visible in the sort dropdown) so copies list adjacently;
 * disabling restores the default sort unless the user picked something else.
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
