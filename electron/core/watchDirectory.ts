// Debounced directory watch shared by custom.css and the CSS theme folder.
// A directory rather than a file: editors that save by writing a new file and
// renaming it over the old one would end a watch on the file itself after the
// first save. Kept free of the electron import so tests can drive it.
import fs from "node:fs";
import path from "node:path";
import log from "./logger.js";

/** Editors fire several events per save; wait for them to settle. */
const WATCH_DEBOUNCE_MS = 100;
/**
 * macOS fs.watch drops events made before its FSEvents stream starts, a short
 * moment after fs.watch returns (nodejs/node#52601, #53111). Compare the
 * directory once against a snapshot taken at registration, after the stream
 * is expected to be live, to catch a change made in that gap.
 *
 * Not covered: libuv shares one FSEventStream among all watches in the process
 * and rebuilds it whenever any watch starts or stops, so a watch already
 * running has the same gap then (for example the theme folder while custom.css
 * is switched on or off). A save in that moment is missed until the next one;
 * rare enough not to check every running watch on each start and stop.
 */
const STARTUP_CHECK_MS = 500;

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
  let check: ReturnType<typeof setTimeout> | null = null;
  let seen = false;
  let watcher: fs.FSWatcher;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, WATCH_DEBOUNCE_MS);
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const before = snapshot(dir, accept);
    watcher = fs.watch(dir, (_event, filename) => {
      if (!accept(filename == null ? null : filename.toString())) return;
      seen = true;
      fire();
    });
    if (before) {
      check = setTimeout(() => {
        check = null;
        // Once an event has come through, onChange re-reads everything, so a
        // change missed before it is picked up too.
        if (seen) return;
        const after = snapshot(dir, accept);
        if (after && !sameSnapshot(before, after)) fire();
      }, STARTUP_CHECK_MS);
    }
  } catch (e) {
    if (check) clearTimeout(check);
    log.warn("[watchDirectory] failed to watch", e);
    return () => {};
  }
  watcher.on("error", (e) => log.warn("[watchDirectory] watcher error", e));
  return () => {
    if (timer) clearTimeout(timer);
    if (check) clearTimeout(check);
    timer = null;
    check = null;
    watcher.close();
  };
}

/**
 * Stamps of the accepted files in `dir`, or null when the directory cannot be
 * listed. An entry that cannot be read is left out rather than failing the
 * whole snapshot, so one bad file does not hide changes to the others.
 */
function snapshot(
  dir: string,
  accept: (name: string | null) => boolean,
): Map<string, string> | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter(accept);
  } catch (e) {
    log.warn("[watchDirectory] failed to list", e);
    return null;
  }
  const stamps = new Map<string, string>();
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name), { bigint: true });
      if (stat.isFile()) {
        stamps.set(
          name,
          `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
        );
      }
    } catch {
      // Gone or unreadable: treated as absent.
    }
  }
  return stamps;
}

function sameSnapshot(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([name, s]) => b.get(name) === s);
}
