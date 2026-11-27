// Structured logger for the main process. Backed by electron-log.
//
// Reasons for centralizing logging:
//  - Packaged builds have no stdout/stderr visible to end users, so console.* is
//    effectively a black hole. A rotated file log under userData/logs lets users
//    attach the log when reporting issues.
//  - The renderer can call the same API and have its messages forwarded over IPC
//    to the same file, so frontend errors don't get lost on reload.
//
// The file lives at <userData>/logs/main.log (with rotation to main.old.log).
import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import log from "electron-log/main";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB before rotation

// Redact anything under the user's home directory (the user name itself, plus
// any nested path that would expose private media file names) and under every
// workspace root, since media often lives on another drive or mount. Both POSIX
// and Windows separators are accepted. We replace the *whole* path tail so a
// leaked "Videos/private.mp4" doesn't survive — only a placeholder reaches the
// file. The tail runs to the end of the line rather than the first space or a
// quote, because file names contain spaces and quotes ("Bob's a b.mp4");
// over-redacting the rest of a line is the safe side.
const HOME_DIR = os.homedir();
const PATH_TAIL = "[^\\r\\n]*";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathRe(dirs: string[]): RegExp | null {
  // util.inspect doubles each backslash of a string inside an object or an
  // Error's properties (`path: 'D:\\Videos\\a.mp4'`), so a Windows separator
  // matches one backslash or two.
  const alts = dirs
    .filter((d) => d.length > 0)
    .map((d) => escapeRegExp(d).replaceAll("\\\\", "\\\\{1,2}"));
  if (alts.length === 0) return null;
  // Windows and macOS (APFS by default) paths are case-insensitive, and a
  // path may be printed in another case than the one stored.
  return new RegExp(
    `(?:${alts.join("|")})${PATH_TAIL}`,
    process.platform === "linux" ? "g" : "gi",
  );
}

const HOME_PATH_RE = pathRe([HOME_DIR]);
const redactedRoots = new Set<string>();
let rootPathRe: RegExp | null = null;

/**
 * Redact paths under these workspace roots from now on. Roots are only ever
 * added: a scan or thumbnail job of a root being removed can still log its
 * paths after the removal, and redacting a stale root costs nothing.
 */
export function redactRoots(roots: readonly string[]): void {
  const before = redactedRoots.size;
  for (const r of roots) redactedRoots.add(r);
  if (redactedRoots.size !== before) rootPathRe = pathRe([...redactedRoots]);
}

export function redactString(s: string): string {
  // Roots first: a root under the home directory then reads as a media path.
  let out = rootPathRe ? s.replace(rootPathRe, "<media-path>") : s;
  if (HOME_PATH_RE) out = out.replace(HOME_PATH_RE, "<user-path>");
  return out;
}

// Node's errors carry the path they failed on, and a failed command its whole
// command line, both as properties and inside the message. These values are
// known, so they are replaced by name in the error's text rather than left to
// the patterns above.
const ERROR_PATH_PROPS = ["path", "dest", "cmd"] as const;
// The other properties kept from an error. The rest (spawnargs, stdout,
// stderr, fields a library adds) may hold a path and are left out.
const ERROR_KEPT_PROPS = ["code", "errno", "syscall", "signal"] as const;

function formatError(e: Error): string {
  const props = e as unknown as Record<string, unknown>;
  let text = e.stack ?? `${e.name}: ${e.message}`;
  for (const key of ERROR_PATH_PROPS) {
    const value = props[key];
    if (typeof value === "string" && value.length > 0)
      text = text.replaceAll(value, `<${key}>`);
  }
  const kept = ERROR_KEPT_PROPS.filter((key) => props[key] !== undefined).map(
    (key) => `${key}: ${inspect(props[key])}`,
  );
  return kept.length > 0 ? `${text} { ${kept.join(", ")} }` : text;
}

/**
 * Render `value` to a string and redact any user-home or workspace paths.
 * Errors are formatted without the properties that hold paths; other objects
 * go through util.inspect so their nested fields are scrubbed too.
 */
export function redactForLog(value: unknown): string {
  const str =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? formatError(value)
        : inspect(value, { depth: 4, breakLength: Infinity });
  return redactString(str);
}

/** Where the log file is written: <userData>/logs/main.log by default. */
export function logFilePath(fileName = "main.log"): string {
  return path.join(app.getPath("userData"), "logs", fileName);
}

let initialized = false;

/**
 * Configure transports and install global error handlers. Safe to call multiple times.
 * Must be called before `app.whenReady()` so early failures are captured.
 */
export function setupLogger(): void {
  if (initialized) return;
  initialized = true;

  // Resolve to <userData>/logs/<fileName>. electron-log's default puts it under
  // libraryDefaultDir which differs by OS; pinning to userData keeps the path
  // predictable for support requests.
  log.transports.file.resolvePathFn = (vars) => logFilePath(vars.fileName);
  log.transports.file.maxSize = MAX_FILE_BYTES;
  log.transports.file.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}";
  log.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}";

  if (app.isPackaged) {
    log.transports.console.level = "warn";
    log.transports.file.level = "info";
  } else {
    log.transports.console.level = "debug";
    log.transports.file.level = "debug";
  }

  // Privacy redaction. Strip anything under the user's home directory or a
  // workspace root (see redactString) from every log message before any transport (file OR console) sees it. Applies to both
  // main-side calls and renderer messages that arrive over IPC, so users can
  // attach the log file in bug reports without leaking media file names or
  // their OS username.
  log.hooks.push((message) => {
    message.data = message.data.map(redactForLog);
    return message;
  });

  // Bridge for log calls coming from the renderer via electron-log/preload.
  // preload: false because preload.ts already imports "electron-log/preload"
  // statically; without this, electron-log additionally injects its own preload
  // via session.registerPreloadScript(), so two preloads end up running.
  log.initialize({ preload: false });

  // Catch uncaught exceptions AND unhandled promise rejections so they make it
  // to the file. startCatching() registers both process.on handlers internally,
  // so don't add another one or every rejection logs twice.
  // showDialog: false to avoid blocking the tray-resident app on a background crash.
  log.errorHandler.startCatching({ showDialog: false });
}

/** Module-scoped logger. Use as `const log = scopedLog("server")` for prefixing. */
export function scopedLog(name: string) {
  return log.scope(name);
}

export default log;
