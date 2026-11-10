import { app } from "electron";
import { handle } from "../core/ipcHandler.js";
import log from "../core/logger.js";
import type { WorkspaceStats } from "../core/types.js";
import { ALL_ID } from "../core/workspaces.js";
import { configLoadProblem } from "../core/appConfig.js";
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
    // While workspaces are being merged into the library (the first launch
    // after the upgrade), nothing is ready, and no view is selected, so the
    // renderer asks for nothing that would wait on them (Workspaces.merge).
    const libraryMerge = ws.mergeProgress();
    if (libraryMerge) {
      return {
        root: null,
        ready: false,
        initError: null,
        initErrorKind: null,
        mediaBase: ctx.mediaBase(),
        workspaceId: null,
        devMode: ctx.isDevMode(),
        libraryMerge,
        libraryRestoredFrom: ctx.libraryRestoredFrom() ?? undefined,
        configProblem: configLoadProblem() ?? undefined,
      };
    }
    const failed = ws.mergeFailures();
    const libraryMergeFailed = failed.length > 0 ? failed : undefined;
    const libraryRestoredFrom = ctx.libraryRestoredFrom() ?? undefined;
    const configProblem = configLoadProblem() ?? undefined;
    if (ws.isAll()) {
      return {
        root: "All",
        ready: ws.allCores().length > 0,
        initError: null,
        initErrorKind: null,
        mediaBase: ctx.mediaBase(),
        workspaceId: ALL_ID,
        devMode: ctx.isDevMode(),
        libraryMergeFailed,
        libraryRestoredFrom,
        configProblem,
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
        libraryMergeFailed,
        libraryRestoredFrom,
        configProblem,
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
      libraryMergeFailed,
      libraryRestoredFrom,
      configProblem,
    };
  });

  // The "Try again" of the merge failure notice. Not awaited: the progress
  // and the outcome arrive as library:merge events, as at startup.
  handle("library_merge_retry", () => {
    ctx.retryLibraryMerge().catch((e: unknown) => {
      log.error("library merge retry failed:", e);
    });
  });

  // Static app/runtime versions for the Settings "About" section.
  handle("about_info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  }));
}
