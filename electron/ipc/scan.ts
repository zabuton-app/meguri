import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";

export function registerScanHandlers(ctx: IpcContext): void {
  handle("scan_start", ({ includeExcluded, rebuild }) =>
    ctx.startScan({ includeExcluded, rebuild }),
  );

  handle("scan_cancel", ({ wsId }) => {
    if (wsId) ctx.cancelScan(wsId);
    else void ctx.abortAllScans();
  });
}
