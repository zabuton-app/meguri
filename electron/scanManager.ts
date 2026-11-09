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
import type { DeriveAutoTags } from "./core/autoTagDeriver.js";
import type { Workspaces } from "./core/workspaces.js";
import type { AutoTagConfig } from "../shared/autoTag.js";
import { FolderWatcher, MAX_PENDING_PATHS } from "./folderWatcher.js";

export interface ScanOptions {
  /** Automatic work can be canceled when folder watching is switched off. */
  watch?: boolean;
  includeExcluded?: boolean;
  rebuild?: boolean;
  paths?: readonly string[];
}

export interface ScanManagerDeps {
  ignoredRoots?: readonly string[];
  ws: Workspaces;
  queryClient: QueryWorkerClient;
  /** Send an event to the renderer (no-op when the window is gone). */
  emit: (channel: string, payload: unknown) => void;
  /** Once the app is quitting no new scan may start. */
  isQuitting: () => boolean;
  /** The auto-tagging configuration and its version (loadAutoTag), read when a scan starts tagging. */
  autoTag: () => { config: AutoTagConfig; version: number };
  /** Evaluates it off the main thread (AutoTagWorkerClient). */
  deriveAutoTags: DeriveAutoTags;
}

export class ScanManager {
  // Workspace IDs with a scan in progress. To avoid chunk-tx contention,
  // concurrent scans of the same workspace are suppressed.
  private readonly scanning = new Set<string>();
  private readonly background = new Set<string>();
  // AbortControllers for in-progress scans, keyed by workspace ID.
  private readonly controllers = new Map<string, AbortController>();
  // Completion promises for in-progress scans, keyed by workspace ID.
  private readonly promises = new Map<string, Promise<void>>();
  private seq = 1;
  private readonly pendingChanges = new Map<string, Set<string> | null>();
  private readonly watcher: FolderWatcher;
  private watching = false;

  constructor(private readonly deps: ScanManagerDeps) {
    this.watcher = new FolderWatcher(
      (id, paths) => this.queueChanges(id, paths),
      (status) => deps.emit("watch:changed", status),
      deps.ignoredRoots,
    );
  }

  watchStatus(): ReturnType<FolderWatcher["status"]> {
    return this.watcher.status();
  }

  setWatching(enabled: boolean): void {
    this.watching = enabled;
    if (!enabled) {
      this.pendingChanges.clear();
      for (const id of this.background) this.controllers.get(id)?.abort();
    }
    this.syncWatchers();
  }

  syncWatchers(): void {
    const unavailable = this.watcher.status().unavailable;
    this.watcher.sync(
      this.deps.ws.list(),
      this.watching && !this.deps.isQuitting(),
    );
    const stillUnavailable = new Set(this.watcher.status().unavailable);
    for (const id of unavailable)
      if (!stillUnavailable.has(id)) this.queueChanges(id, undefined);
  }

  unwatch(id: string): void {
    this.watcher.remove(id);
    this.pendingChanges.delete(id);
  }

  stopWatching(): void {
    this.watching = false;
    this.pendingChanges.clear();
    this.watcher.close();
  }

  /** Catch up once on launch, one workspace at a time to limit background load. */
  async catchUp(): Promise<void> {
    const roots = this.deps.ws
      .list()
      .filter((r) => r.path)
      .sort((a, b) => Number(b.active) - Number(a.active));
    for (const root of roots) {
      if (this.deps.isQuitting() || !this.watching) return;
      try {
        const core = this.deps.ws.byId(root.id);
        if (!core) continue;
        this.scanCore(core, root.id, { watch: true });
        await this.promises.get(root.id);
      } catch (error) {
        log.warn("watch-folder catch-up failed", error);
      }
    }
  }

  private queueChanges(id: string, paths: string[] | undefined): void {
    if (!this.watching || this.deps.isQuitting() || !this.deps.ws.pathOf(id))
      return;
    const pending = this.pendingChanges.get(id);
    if (!paths || pending === null) this.pendingChanges.set(id, null);
    else {
      const merged = new Set([...(pending ?? []), ...paths]);
      this.pendingChanges.set(
        id,
        merged.size > MAX_PENDING_PATHS ? null : merged,
      );
    }
    if (this.scanning.has(id)) return;
    this.startChanges(id);
  }

  private startChanges(id: string): void {
    if (
      this.scanning.has(id) ||
      !this.pendingChanges.has(id) ||
      this.deps.isQuitting() ||
      !this.watching ||
      !this.deps.ws.pathOf(id)
    )
      return;
    const paths = this.pendingChanges.get(id);
    this.pendingChanges.delete(id);
    try {
      const core = this.deps.ws.byId(id);
      if (!core) return;
      this.scanCore(core, id, {
        watch: true,
        paths: paths == null ? undefined : [...paths],
      });
    } catch (error) {
      log.warn("watch-folder scan could not start", error);
    }
  }

  /**
   * Scan the active workspace, or — in the virtual "All" view — every
   * registered workspace concurrently (each gets its own job/progress).
   * Returns the first job's id for tracking ("" when nothing started).
   */
  start(opts: ScanOptions = {}): string {
    const { ws } = this.deps;
    if (ws.isAll()) {
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
    this.pendingChanges.delete(wsId);
    this.controllers.get(wsId)?.abort();
    await this.promises.get(wsId);
  }

  /** Abort every running scan. Resolves once they have all settled. */
  abortAll(): Promise<unknown> {
    this.pendingChanges.clear();
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
    if (wsId && opts.watch) this.background.add(wsId);
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
          {
            rebuild: opts.rebuild,
            paths: opts.paths,
            ignoredRoots: this.deps.ignoredRoots,
            signal: controller.signal,
            // Read when the scan starts tagging (see runScan).
            autoTag: this.deps.autoTag,
            workspaceId: wsId ?? undefined,
            deriveAutoTags: this.deps.deriveAutoTags,
          },
        );
      } catch (err) {
        log.error("scan failed", err);
        emit("scan:done", { jobId, stats: emptyScanStats(), error: true });
      } finally {
        if (wsId) {
          this.scanning.delete(wsId);
          this.background.delete(wsId);
          this.controllers.delete(wsId);
          this.promises.delete(wsId);
        }
        // Scans can change duplicate group membership; clear derived query caches.
        // Runs after the bookkeeping above so a failure here can never leave the
        // workspace stuck in the "scanning" state.
        try {
          await queryClient.invalidateCaches();
        } finally {
          if (wsId) this.startChanges(wsId);
        }
      }
    })();
    if (wsId) this.promises.set(wsId, promise);
    void promise;
    return jobId;
  }
}
