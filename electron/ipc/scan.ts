import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";
import { updateConfig } from "../core/appConfig.js";

export function registerScanHandlers(ctx: IpcContext): void {
  handle("watch_get", () => ctx.scans.watchStatus());
  handle("watch_set", ({ enabled }) => {
    updateConfig((config) => ({ ...config, watchFolders: enabled }));
    ctx.scans.setWatching(enabled);
    if (enabled) void ctx.scans.catchUp();
    return ctx.scans.watchStatus();
  });
  handle("scan_start", ({ includeExcluded, rebuild }) =>
    ctx.scans.start({ includeExcluded, rebuild }),
  );

  handle("scan_cancel", ({ wsId }) => {
    if (wsId) void ctx.scans.abort(wsId);
    else void ctx.scans.abortAll();
  });
}
