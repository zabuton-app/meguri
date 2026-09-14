import { loadConfig, updateConfig } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";

export function registerLogoHandlers(ctx: IpcContext): void {
  handle("logo_get", () => loadConfig().logo);
  handle("logo_set", ({ logo }) => {
    updateConfig((c) => ({ ...c, logo }));
    ctx.applyLogo(logo);
    return logo;
  });
}
