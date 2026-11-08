import path from "node:path";
import type { CustomCssState } from "../../shared/ipc/channels.js";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import {
  CUSTOM_CSS_FILE,
  ensureCustomCssFile,
  readCustomCss,
  watchCustomCss,
} from "../core/customCss.js";
import { handle } from "../core/ipcHandler.js";
import { baseDataDir } from "../core/paths.js";
import type { IpcContext } from "./context.js";
import { openDetached } from "./shell.js";

// The one IPC group that holds state of its own: the custom.css watcher. It
// lives here rather than in main.ts because nothing outside these handlers
// starts or stops it, and it needs no teardown on quit (it dies with the
// process; emit is a no-op once the window is gone).
export function registerCustomCssHandlers(ctx: IpcContext): void {
  const file = path.join(baseDataDir(), CUSTOM_CSS_FILE);
  let stopWatching: (() => void) | null = null;

  const state = (): CustomCssState => {
    const { enabled } = loadConfig().customCss;
    return { enabled, path: file, css: enabled ? readCustomCss(file) : null };
  };

  // The watcher runs only while the stylesheet is on.
  const syncWatcher = (enabled: boolean) => {
    if (enabled && !stopWatching) {
      stopWatching = watchCustomCss(file, () =>
        ctx.emit("custom-css:changed", { css: readCustomCss(file) }),
      );
    } else if (!enabled && stopWatching) {
      stopWatching();
      stopWatching = null;
    }
  };

  syncWatcher(loadConfig().customCss.enabled);

  handle("custom_css_get", state);
  handle("custom_css_set_enabled", ({ enabled }) => {
    updateConfig((c) => ({ ...c, customCss: { ...c.customCss, enabled } }));
    // From what was saved: saveConfig logs a failed write instead of
    // throwing, and the watcher must not run while the switch reads off.
    syncWatcher(loadConfig().customCss.enabled);
    return state();
  });
  handle("custom_css_open", () => {
    ensureCustomCssFile(file);
    openDetached(file);
  });
}
