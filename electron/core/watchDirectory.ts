// Debounced directory watch shared by custom.css and the CSS theme folder.
// A directory rather than a file: editors that save by writing a new file and
// renaming it over the old one would end a watch on the file itself after the
// first save. Kept free of the electron import so tests can drive it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import log from "./logger.js";

/** Editors fire several events per save; wait for them to settle. */
const WATCH_DEBOUNCE_MS = 100;
const POLL_INTERVAL_MS = 500;

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
    if (process.platform === "darwin") {
      return pollDirectory(dir, accept, onChange);
    }
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

// macOS fs.watch can miss edits made before its event stream starts. Poll only
// the two CSS settings locations on this platform. Keep a synchronous initial
// snapshot so a save immediately after registration is seen on the first poll.
function pollDirectory(
  dir: string,
  accept: (name: string | null) => boolean,
  onChange: () => void,
): () => void {
  let contents = new Map<string, string>();
  for (const name of fs.readdirSync(dir).filter(accept)) {
    const stat = fs.statSync(path.join(dir, name), {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (stat?.isFile()) contents.set(name, fileStamp(stat));
  }
  let stopped = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout>;

  async function poll() {
    try {
      const names = await fsp
        .readdir(dir)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      const next = new Map<string, string>();
      for (const name of names.filter(accept)) {
        const stat = await fsp
          .stat(path.join(dir, name), { bigint: true })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
        if (stat?.isFile()) next.set(name, fileStamp(stat));
      }
      failed = false;
      if (
        !stopped &&
        (next.size !== contents.size ||
          [...next].some(([name, stamp]) => contents.get(name) !== stamp))
      ) {
        contents = next;
        onChange();
      }
    } catch (e) {
      if (!stopped && !failed)
        log.warn("[watchDirectory] failed to check", dir, e);
      failed = true;
    } finally {
      if (!stopped) schedule();
    }
  }

  function schedule() {
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    timer.unref();
  }

  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function fileStamp(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
