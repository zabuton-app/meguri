import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";

export function registerScanHandlers(ctx: IpcContext): void {
  handle("scan_start", ({ includeExcluded, rebuild }) =>
    ctx.scans.start({ includeExcluded, rebuild }),
  );

  handle("scan_cancel", ({ wsId }) => {
    if (wsId) void ctx.scans.abort(wsId);
    else void ctx.scans.abortAll();
  });
}
