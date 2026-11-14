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
  handle("logo_images", () => ({
    dark: dataUrl(ctx.logos.app.dark),
    light: dataUrl(ctx.logos.app.light),
    enso: dataUrl(ctx.logos.app.enso),
  }));
}

function dataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}
