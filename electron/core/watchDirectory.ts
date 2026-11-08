// Debounced directory watch shared by custom.css and the CSS theme folder.
// A directory rather than a file: editors that save by writing a new file and
// renaming it over the old one would end a watch on the file itself after the
// first save. Kept free of the electron import so tests can drive it.
import fs from "node:fs";
import log from "./logger.js";

/** Editors fire several events per save; wait for them to settle. */
const WATCH_DEBOUNCE_MS = 100;

/**
 * Call `onChange` once events for entries that `accept` lets through have
 * settled. `accept` receives null when the platform does not report a name;
 * treat that as a possible hit. Creates the directory if needed. Returns a
 * function that stops watching.
 */
export function watchDirectory(
  dir: string,
  accept: (name: string | null) => boolean,
  onChange: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher;
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      if (!accept(filename == null ? null : filename.toString())) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, WATCH_DEBOUNCE_MS);
    });
  } catch (e) {
    log.warn("[watchDirectory] failed to watch", dir, e);
    return () => {};
  }
  watcher.on("error", (e) => log.warn("[watchDirectory] watcher error", e));
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
}
