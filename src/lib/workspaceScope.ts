import type { QueryClient } from "@tanstack/react-query";

/**
 * Refetch what changes with the active workspace, after a switch.
 *
 * Only these, not invalidateQueries(): the chained files_search refetches of
 * a blanket invalidation during a scan would stall the main process. app_status
 * comes first — its new workspace ID rekeys files_search, which refetches on
 * its own — then the workspace list and the current search.
 */
export async function invalidateWorkspaceScoped(qc: QueryClient) {
  await qc.refetchQueries({ queryKey: ["app_status"] });
  await qc.invalidateQueries({ queryKey: ["workspaces_list"] });
  await qc.invalidateQueries({ queryKey: ["files_search"] });
  // All and collections keep their scope when a workspace goes, so their
  // graph would keep its files.
  await qc.invalidateQueries({ queryKey: ["graph_build"] });
}
