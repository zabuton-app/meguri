// Graph view: the graph itself is a read-only query on the query worker; the
// cached node positions are small JSON files main reads and writes directly.
import { COLLECTION_ID_PREFIX, ALL_ID } from "../../shared/workspaceIds.js";
import { GRAPH_MAX_FILES, type GraphPayload } from "../../shared/ipc/graph.js";
import { handle } from "../core/ipcHandler.js";
import {
  keepRegisteredWorkspaces,
  layoutPathFor,
  readLayoutSettled,
  writeLayout,
  type LayoutScopes,
} from "../core/graph/layoutCache.js";
import log from "../core/logger.js";
import { baseDataDir, dataDirForRoot } from "../core/paths.js";
import type { Workspaces } from "../core/workspaces.js";
import type { IpcContext } from "./context.js";
import { queryTargets } from "./helpers.js";

export function layoutScopes(ws: Workspaces): LayoutScopes {
  return {
    baseDir: baseDataDir(),
    workspaceDataDir: (id) => {
      const p = ws.pathOf(id);
      return p ? dataDirForRoot(p) : null;
    },
    hasCollection: (id) => ws.collections().some((c) => c.id === id),
    workspaceIds: () =>
      new Set(
        ws
          .list()
          .filter((w) => w.id !== ALL_ID)
          .map((w) => w.id),
      ),
  };
}

export function registerGraphHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  // Target resolution mirrors files_search, so the graph shows exactly the
  // files the list would.
  handle("graph_build", ({ query, maxFiles }) => {
    const collection = ws.activeCollection();
    const cap = maxFiles ?? GRAPH_MAX_FILES;
    return collection
      ? queryClient.run<GraphPayload>({
          kind: "graph",
          targets: queryTargets(ws.allCores()),
          query,
          refs: collection.items,
          maxFiles: cap,
        })
      : queryClient.run<GraphPayload>({
          kind: "graph",
          targets: queryTargets(ws.queryCores()),
          query,
          maxFiles: cap,
        });
  });

  handle("graph_layout_get", async ({ scope, dims = 2 }) => {
    const file = layoutPathFor(scope, layoutScopes(ws), dims);
    return file ? readLayoutSettled(file, dims) : null;
  });

  handle("graph_layout_set", async ({ scope, keys, xy, dims = 2 }) => {
    const scopes = layoutScopes(ws);
    const file = layoutPathFor(scope, scopes, dims);
    // An unknown scope is a save that arrived after its workspace or
    // collection was removed: dropping it keeps the file from coming back.
    if (!file) return;
    const keep =
      scope === ALL_ID || scope.startsWith(COLLECTION_ID_PREFIX)
        ? keepRegisteredWorkspaces(() => scopes.workspaceIds())
        : undefined;
    try {
      await writeLayout(file, { keys, xy }, keep, dims);
    } catch (e) {
      // A cache that cannot be written only costs a re-layout next time.
      log.warn(`failed to save the graph layout for ${scope}: ${String(e)}`);
    }
  });
}
