import { ALL_ID } from "@/ipc/client";
import { COLLECTION_ID_PREFIX } from "@shared/workspaceIds";

/**
 * The workspace of the file a `/file/:id` route shows: "?ws=" (set by every
 * list/grid link, required in "All" and collection views), falling back to
 * the active workspace for single-workspace navigation. The "All"/collection
 * sentinels are not resolvable workspaces, so they fall back to "".
 * Shared by the detail and by Home, which marks the docked peek's file.
 */
export function fileWorkspaceId(
  wsParam: string | null,
  activeId: string | null | undefined,
): string {
  if (wsParam !== null) return wsParam;
  if (!activeId || activeId === ALL_ID) return "";
  return activeId.startsWith(COLLECTION_ID_PREFIX) ? "" : activeId;
}
