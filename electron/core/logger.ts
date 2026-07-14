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
// any nested path that would expose private media file names). Both POSIX and
// Windows separators are accepted. We replace the *whole* path tail so a leaked
// "Videos/private.mp4" doesn't survive — only "<user-path>" reaches the file.
const HOME_DIR = os.homedir();
const HOME_PATH_RE = new RegExp(
  HOME_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:[\\\\/][^\\s\"'`<>]*)?",
  "g",
);

function redactString(s: string): string {
  return s.replace(HOME_PATH_RE, "<user-path>");
}

/**
 * Render `value` to a string and redact any user-home paths. Objects/Errors are
 * passed through util.inspect so their nested fields (Error.stack, etc.) are
 * scrubbed too — we don't keep the original structure because once redacted
 * the post-format pipeline can just consume a plain string.
 */
function redactForLog(value: unknown): string {
  const str =
    typeof value === "string"
      ? value
      : inspect(value, { depth: 4, breakLength: Infinity });
  return redactString(str);
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
  log.transports.file.resolvePathFn = (vars) =>
    path.join(app.getPath("userData"), "logs", vars.fileName ?? "main.log");
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

  // Privacy redaction. Strip anything under the user's home directory from every
  // log message before any transport (file OR console) sees it. Applies to both
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
