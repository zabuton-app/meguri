// Scan orchestration: which workspaces are being scanned, how to abort them,
// and the renderer events a scan reports. main.ts owns one instance and hands
// it to the IPC layer; nothing else keeps scan state.
//
// Lives beside main.ts rather than under core/: it drives core's pipeline
// (jobs.ts) but also knows the renderer event channels, which core does not.
import type { Core } from "./core/index.js";
import { runScan } from "./core/jobs.js";
import log from "./core/logger.js";
import * as q from "./core/queries.js";
import { emptyScanStats } from "./core/scan.js";
import type { QueryWorkerClient } from "./core/queryWorkerClient.js";
import type { Workspaces } from "./core/workspaces.js";

export interface ScanOptions {
  includeExcluded?: boolean;
  rebuild?: boolean;
}

export interface ScanManagerDeps {
  ws: Workspaces;
  queryClient: QueryWorkerClient;
  /** Send an event to the renderer (no-op when the window is gone). */
  emit: (channel: string, payload: unknown) => void;
  /** Once the app is quitting no new scan may start. */
  isQuitting: () => boolean;
}

export class ScanManager {
  // Workspace IDs with a scan in progress. To avoid chunk-tx contention,
  // concurrent scans of the same workspace are suppressed.
  private readonly scanning = new Set<string>();
  // AbortControllers for in-progress scans, keyed by workspace ID.
  private readonly controllers = new Map<string, AbortController>();
  // Completion promises for in-progress scans, keyed by workspace ID.
  private readonly promises = new Map<string, Promise<void>>();
  private seq = 1;

  constructor(private readonly deps: ScanManagerDeps) {}

  /**
   * Scan the active workspace, or — in the virtual "All" / "Home" views —
   * every registered workspace concurrently (each gets its own job/progress).
   * Returns the first job's id for tracking ("" when nothing started).
   */
  start(opts: ScanOptions = {}): string {
    const { ws } = this.deps;
    if (ws.isCrossWorkspace()) {
      let first = "";
      for (const { id, core } of ws.allCores()) {
        const jobId = this.scanCore(core, id, opts);
        if (jobId && !first) first = jobId;
      }
      return first;
    }
    const core = ws.active();
    if (!core) return "";
    return this.scanCore(core, ws.activeId, opts);
  }

  /** Abort one workspace's scan and wait for it to settle. */
  async abort(wsId: string): Promise<void> {
    this.controllers.get(wsId)?.abort();
    await this.promises.get(wsId);
  }

  /** Abort every running scan. Resolves once they have all settled. */
  abortAll(): Promise<unknown> {
    for (const ctrl of this.controllers.values()) ctrl.abort();
    return Promise.allSettled([...this.promises.values()]);
  }

  /** Start a scan for a single workspace's Core. Returns the job id (empty if already scanning). */
  private scanCore(core: Core, wsId: string | null, opts: ScanOptions): string {
    const { emit, queryClient } = this.deps;
    if (this.deps.isQuitting()) return ""; // shutdown has aborted scans; don't start new ones
    if (wsId && this.scanning.has(wsId)) return ""; // don't start again if already running
    const jobId = `job-${this.seq++}`;
    if (wsId) this.scanning.add(wsId);
    const controller = new AbortController();
    if (wsId) this.controllers.set(wsId, controller);
    const promise = (async () => {
      try {
        if (opts.includeExcluded) q.clearExcludedFiles(core.db, core.rootId);
        await runScan(
          core,
          jobId,
          (e) => {
            if (e.type === "progress")
              emit("scan:progress", {
                jobId: e.jobId,
                phase: e.phase,
                done: e.done,
                total: e.total,
              });
            else if (e.type === "thumbDone")
              emit("thumb:done", { id: e.id, workspaceId: wsId });
            else if (e.type === "done")
              emit("scan:done", {
                jobId: e.jobId,
                stats: e.stats,
                aborted: e.aborted,
              });
          },
          { rebuild: opts.rebuild, signal: controller.signal },
        );
      } catch (err) {
        log.error("scan failed", err);
        emit("scan:done", { jobId, stats: emptyScanStats(), error: true });
      } finally {
        if (wsId) {
          this.scanning.delete(wsId);
          this.controllers.delete(wsId);
          this.promises.delete(wsId);
        }
        // Scans can change duplicate group membership; clear derived query caches.
        // Runs after the bookkeeping above so a failure here can never leave the
        // workspace stuck in the "scanning" state.
        await queryClient.invalidateCaches();
      }
    })();
    if (wsId) this.promises.set(wsId, promise);
    void promise;
    return jobId;
  }
}
