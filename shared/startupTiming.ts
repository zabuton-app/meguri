// Startup timing (#558): each process marks its startup steps with
// performance.mark() and writes them to main.log as one line when startup
// ends, however it ends: the steps it reached and how it ended. Only the
// first page load of the first window counts as the renderer's startup.
// Shared by main and the renderer.

/** Prefix of the marks this records, so others' marks (React's) are left out. */
export const STARTUP_MARK_PREFIX = "startup:";

/**
 * The startup marks of this process, in order, as milliseconds since `origin`
 * (an epoch time in ms, as performance.timeOrigin is): main passes its own
 * timeOrigin, the renderer main's, so both lines count from the process start.
 */
export function startupMarks(
  // Structural: the main process's tsconfig has no DOM types.
  perf: {
    timeOrigin: number;
    getEntriesByType(type: "mark"): { name: string; startTime: number }[];
  },
  origin: number,
): { name: string; ms: number }[] {
  const offset = perf.timeOrigin - origin;
  return perf
    .getEntriesByType("mark")
    .filter((m) => m.name.startsWith(STARTUP_MARK_PREFIX))
    .map((m) => ({
      name: m.name.slice(STARTUP_MARK_PREFIX.length),
      ms: Math.round(m.startTime + offset),
    }));
}

/**
 * `[startup] main (ok, since process start): ready 210ms, window 300ms`.
 * `outcome` says how startup ended, so a line cut short by a failure (or
 * with no list to wait for) reads as that rather than as a fast startup.
 */
export function formatStartupLine(
  label: string,
  outcome: string,
  marks: readonly { name: string; ms: number }[],
): string {
  return `[startup] ${label} (${outcome}, since process start): ${marks.map((m) => `${m.name} ${m.ms}ms`).join(", ")}`;
}
