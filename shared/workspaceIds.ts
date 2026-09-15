/** Sentinel workspace ID for the virtual "All" (cross-workspace) view. */
export const ALL_ID = "__all__";

/**
 * Sentinel workspace ID for the virtual "Home" view: the shelves screen
 * (Recently added / Picks for today across every workspace) rather than a
 * list. Like "All" it has no Core of its own and is never scanned.
 */
export const HOME_ID = "__home__";

/** Whether an id names one of the pinned virtual views ("Home" / "All"). */
export function isVirtualWorkspaceId(id: string): boolean {
  return id === HOME_ID || id === ALL_ID;
}

/**
 * Display names of the virtual views as the main process reports them
 * (`app_status.root`, `WorkspaceInfo.label`); the renderer translates the
 * rail's own labels itself.
 */
export const VIRTUAL_WORKSPACE_LABELS: Record<string, string> = {
  [HOME_ID]: "Home",
  [ALL_ID]: "All",
};

/** Prefix that marks an active-target string as a user collection. */
export const COLLECTION_ID_PREFIX = "collection:";

/**
 * ID of the built-in "Watch Later" collection. Unlike user collections (whose IDs
 * are random UUIDs) this one is a fixed constant: it is seeded on config load and
 * both processes need to address it without looking it up by name.
 */
export const WATCH_LATER_ID = "watch-later";

/** Build the active-target string for a collection (passed to workspaceSwitch). */
export function collectionTarget(id: string): string {
  return `${COLLECTION_ID_PREFIX}${id}`;
}
