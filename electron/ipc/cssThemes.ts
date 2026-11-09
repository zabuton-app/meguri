import path from "node:path";
import fs from "node:fs";
import type { CssThemesState } from "../../shared/ipc/channels.js";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import {
  CSS_THEMES_DIR,
  listCssThemes,
  readCssTheme,
  watchCssThemes,
} from "../core/cssThemes.js";
import { handle } from "../core/ipcHandler.js";
import { baseDataDir } from "../core/paths.js";
import type { IpcContext } from "./context.js";
import { openDetached } from "./shell.js";

// Like custom.css (see ./customCss.ts), the watcher on the themes folder lives
// with these handlers: nothing else starts or stops it, and it needs no
// teardown on quit. It runs for the whole session, because a file added while
// no theme is picked still has to show up in the list.
export function registerCssThemeHandlers(ctx: IpcContext): void {
  const dir = path.join(baseDataDir(), CSS_THEMES_DIR);

  const state = (): CssThemesState => {
    const themes = listCssThemes(dir);
    const stored = loadConfig().cssTheme;
    // A picked file that is gone reads as none, and comes back by itself if
    // the file does: the stored choice is left as it is.
    const selected =
      stored && themes.some((t) => t.file === stored) ? stored : null;
    return {
      themes,
      selected,
      css: selected ? readCssTheme(dir, selected) : null,
      dir,
    };
  };

  watchCssThemes(dir, () => ctx.emit("css-themes:changed", state()));

  handle("css_themes_get", state);
  handle("css_theme_select", ({ file }) => {
    if (file !== null && !listCssThemes(dir).some((t) => t.file === file)) {
      throw new Error("no such theme file");
    }
    updateConfig((c) => ({ ...c, cssTheme: file }));
    return state();
  });
  handle("css_themes_open_folder", () => {
    fs.mkdirSync(dir, { recursive: true });
    openDetached(dir);
  });
}
