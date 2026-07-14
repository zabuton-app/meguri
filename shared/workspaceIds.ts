/** Sentinel workspace ID for the virtual "All" (cross-workspace) view. */
export const ALL_ID = "__all__";

/** Prefix that marks an active-target string as a user collection. */
export const COLLECTION_ID_PREFIX = "collection:";

/** Build the active-target string for a collection (passed to workspaceSwitch). */
export function collectionTarget(id: string): string {
  return `${COLLECTION_ID_PREFIX}${id}`;
}
