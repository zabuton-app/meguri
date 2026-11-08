// User stylesheet: <userData>/custom.css, injected by the renderer after the
// theme variables. This module only reads, creates and watches the file; the
// on/off switch lives in appConfig and the wiring in electron/ipc/customCss.ts.
// Kept free of the electron import so the tests can drive it on a temp dir.
import fs from "node:fs";
import path from "node:path";
import log from "./logger.js";

export const CUSTOM_CSS_FILE = "custom.css";

/** Editors fire several events per save; wait for them to settle. */
const WATCH_DEBOUNCE_MS = 100;

export const CUSTOM_CSS_TEMPLATE = `/*
 * Meguri custom CSS
 *
 * Turn this on under Settings > General > Custom CSS. Changes apply as soon as
 * you save this file.
 *
 * Theme colors are CSS variables named --c-*. The themes declare them on
 * html[data-theme="<id>"], so a plain :root rule loses to them; use one of
 * the selectors below instead.
 *
 * Available variables:
 *   --c-bg, --c-surface, --c-overlay, --c-hover, --c-border, --c-border-strong,
 *   --c-muted, --c-secondary-fg,
 *   --c-fg, --c-bright-fg, --c-highlight, --c-error, --c-warn, --c-accent2,
 *   --c-success, --c-info, --c-primary, --c-secondary-accent, --c-special
 *
 * Some parts of the UI carry a data-slot attribute to target:
 *   workspace-rail     side rail
 *   home-header        workspace info header
 *   filter-bar         search and filters
 *   status-bar         footer
 *   audio-player-bar   audio player at the bottom
 *   media-card         a file in the grid
 *   media-row          a file in the list
 *   folder-card        a folder in the grid
 *   folder-row         a folder in the list
 *   modal-panel        the panel of a full-size window (settings, file
 *                      details, discovery, history, tags, ...)
 * The focused item has aria-current="true".
 *
 * External resources (@import or url() pointing at the network) are blocked
 * by the app's Content Security Policy, so this file never makes Meguri go
 * online.
 *
 * If something breaks and the settings are hard to reach, delete or rename
 * this file and the app goes back to normal.
 */

/* Every theme */
/*
html[data-theme] {
  --c-primary: #e06c75;
}
*/

/* One theme only (the ids are like "gruvbox-dark", "nord-light") */
/*
html[data-theme="gruvbox-dark"] {
  --c-bg: #1d2021;
}
*/

/* A part of the UI: the side rail */
/*
[data-slot="workspace-rail"] {
  background-color: var(--c-surface);
}
*/
`;

/** The file contents, or null when it does not exist or cannot be read. */
export function readCustomCss(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("[customCss] failed to read", file, e);
    }
    return null;
  }
}

/** Write the template unless the file already exists (never overwrites). */
export function ensureCustomCssFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, CUSTOM_CSS_TEMPLATE, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/**
 * Call `onChange` after the file is created, saved or deleted. Watches the
 * directory rather than the file: editors that save by writing a new file and
 * renaming it over the old one would end a watch on the file itself after the
 * first save. Returns a function that stops watching.
 */
export function watchCustomCss(file: string, onChange: () => void): () => void {
  const dir = path.dirname(file);
  const name = path.basename(file);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher;
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      // Some platforms do not report the name; treat that as a possible hit.
      if (filename != null && filename.toString() !== name) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, WATCH_DEBOUNCE_MS);
    });
  } catch (e) {
    log.warn("[customCss] failed to watch", dir, e);
    return () => {};
  }
  watcher.on("error", (e) => log.warn("[customCss] watcher error", e));
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
}
