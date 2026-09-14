import { app } from "electron";
import { handle } from "../core/ipcHandler.js";
import type { WorkspaceStats } from "../core/types.js";
import { ALL_ID } from "../core/workspaces.js";
import type { IpcContext } from "./context.js";
import { queryTargets } from "./helpers.js";

export function registerStatusHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  handle("workspace_stats", () =>
    // Aggregate across every workspace under the virtual "All" view; for a single
    // active workspace just read its DB directly. Returns zeros/null when nothing is mounted.
    queryClient.run<WorkspaceStats>({
      kind: "stats",
      targets: queryTargets(ws.queryCores()),
    }),
  );

  handle("app_status", () => {
    if (ws.isAll()) {
      return {
        root: "All",
        ready: ws.allCores().length > 0,
        initError: null,
        initErrorKind: null,
        mediaBase: ctx.mediaBase(),
        workspaceId: ALL_ID,
        devMode: ctx.isDevMode(),
      };
    }
    const activeCollection = ws.activeCollection();
    if (activeCollection) {
      return {
        root: activeCollection.name,
        ready: ws.allCores().length > 0,
        initError: null,
        initErrorKind: null,
        mediaBase: ctx.mediaBase(),
        workspaceId: ws.activeId,
        devMode: ctx.isDevMode(),
      };
    }
    const core = ws.active();
    return {
      root: core?.root ?? null,
      ready: core != null,
      initError: ws.initError(),
      initErrorKind: ws.initErrorKind(),
      mediaBase: ctx.mediaBase(),
      workspaceId: ws.activeId,
      devMode: ctx.isDevMode(),
    };
  });

  // Static app/runtime versions for the Settings "About" section.
  handle("about_info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  }));
}
