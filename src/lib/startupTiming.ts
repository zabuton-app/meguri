// The renderer's startup timings (#558): marked here and written to main.log
// as one line, through the renderer logger, when the first list settles.
import log from "@/lib/logger";
import type { AppStatus } from "@shared/ipc/schema";
import {
  STARTUP_MARK_PREFIX,
  formatStartupLine,
  startupMarks,
} from "@shared/startupTiming";

/**
 * Set once the line is written. Session storage outlives a reload of the page
 * (after a renderer crash too), which is not startup; a window made later gets
 * no start time from main (createWindow()), so it writes nothing either.
 */
const LOGGED_KEY = "meguri:startup-logged";

/** Mark a startup step; only its first time counts (StrictMode runs effects twice). */
export function markStartup(step: string): void {
  const name = STARTUP_MARK_PREFIX + step;
  if (performance.getEntriesByName(name, "mark").length > 0) return;
  performance.mark(name);
}

/** How the renderer's startup ended, or null while it has not. */
export type StartupOutcome =
  "list shown" | "list failed" | "no workspace" | "workspace error";

/**
 * Startup ends with the first list: shown, failed, or none to show (no
 * workspace open, or the one open failed). A library merge is not an end: the
 * list follows it.
 */
export function startupOutcome(
  status: AppStatus | undefined,
  list: { shown: boolean; failed: boolean },
): StartupOutcome | null {
  if (!status) return null;
  if (status.ready) {
    if (list.shown) return "list shown";
    if (list.failed) return "list failed";
    return null;
  }
  if (status.libraryMerge) return null;
  return status.initError ? "workspace error" : "no workspace";
}

/** Write the renderer's startup line, once for the first page of the first window. */
export function logStartupTimings(outcome: StartupOutcome): void {
  const origin = window.api?.startupOrigin ?? 0;
  if (!(origin > 0)) return;
  try {
    if (sessionStorage.getItem(LOGGED_KEY)) return;
    sessionStorage.setItem(LOGGED_KEY, "1");
  } catch {
    // Without it, a reload could not be told from startup: write nothing.
    return;
  }
  if (outcome === "list shown") markStartup("first list");
  log.info(
    formatStartupLine("renderer", outcome, startupMarks(performance, origin)),
  );
}
