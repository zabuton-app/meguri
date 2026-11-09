// CSS theme files: <userData>/themes/*.css, one of which the user can pick in
// Settings. The renderer layers the picked one between the base16 scheme and
// custom.css. This module lists, names and reads the files; the selection
// lives in appConfig and the wiring in electron/ipc/cssThemes.ts. Kept free of
// the electron import so the tests can drive it on a temp dir.
import fs from "node:fs";
import path from "node:path";
import type { CssThemeEntry } from "../../shared/ipc/channels.js";
import log from "./logger.js";
import { watchDirectory } from "./watchDirectory.js";

export const CSS_THEMES_DIR = "themes";

export type { CssThemeEntry };

/** Longest display name taken from a theme's @name comment. */
const MAX_NAME = 64;

/**
 * How much of each file is read to find its @name. The comment sits at the
 * top, and a theme with fonts or images embedded as data: URIs can run to
 * megabytes, so the listing never reads whole files.
 */
const NAME_PROBE_BYTES = 4096;

/**
 * Whether `file` is a plain theme file name: no directory part, so it can
 * only ever resolve inside the themes directory.
 */
export function isThemeFileName(file: string): boolean {
  return (
    file.endsWith(".css") &&
    file.length > ".css".length &&
    path.basename(file) === file &&
    !file.includes("/") &&
    !file.includes("\\")
  );
}

/** The `@name` from a comment at the top of the file, if any. */
export function themeNameFrom(css: string): string | null {
  const comment = /^\s*\/\*([\s\S]*?)\*\//.exec(css);
  const name = comment && /@name[ \t]+([^\r\n]+)/.exec(comment[1]);
  const trimmed = name?.[1].replace(/\*+\s*$/, "").trim();
  return trimmed ? trimmed.slice(0, MAX_NAME) : null;
}

/** The theme files in `dir`, sorted by display name. Empty if `dir` is missing. */
export function listCssThemes(dir: string): CssThemeEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(isThemeFileName);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("[cssThemes] failed to list", dir, e);
    }
    return [];
  }
  const entries: CssThemeEntry[] = [];
  for (const file of files) {
    const head = readHead(path.join(dir, file));
    // Not a regular file (a directory or pipe named like a theme), or one
    // that vanished mid-listing.
    if (head === null) continue;
    entries.push({ file, name: themeNameFrom(head) ?? file.slice(0, -4) });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The contents of one theme file, or null when it cannot be read. Anything
 * but a regular file is refused: reading a named pipe would block main.
 */
export function readCssTheme(dir: string, file: string): string | null {
  if (!isThemeFileName(file)) return null;
  const full = path.join(dir, file);
  try {
    if (!fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, "utf8");
  } catch (e) {
    warnUnlessMissing(file, e);
    return null;
  }
}

/** The first NAME_PROBE_BYTES of a regular file, or null. */
function readHead(full: string): string | null {
  let fd: number | null = null;
  try {
    if (!fs.statSync(full).isFile()) return null;
    fd = fs.openSync(full, "r");
    const buf = Buffer.alloc(NAME_PROBE_BYTES);
    const n = fs.readSync(fd, buf, 0, NAME_PROBE_BYTES, 0);
    return buf.toString("utf8", 0, n);
  } catch (e) {
    warnUnlessMissing(path.basename(full), e);
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function warnUnlessMissing(file: string, e: unknown): void {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    log.warn("[cssThemes] failed to read", file, e);
  }
}

/**
 * Call `onChange` when a theme file is added, saved, renamed or removed.
 * Creates the directory. Returns a function that stops watching.
 */
export function watchCssThemes(dir: string, onChange: () => void): () => void {
  return watchDirectory(
    dir,
    (entry) => entry === null || entry.endsWith(".css"),
    onChange,
  );
}
