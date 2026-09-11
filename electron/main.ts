// Electron main process. Workspaces management, media server, IPC, and auto scan.
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  powerMonitor,
  session,
  shell,
  Tray,
} from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { DEFAULT_LOGO, loadConfig, updateConfig } from "./core/appConfig.js";
import type { Core } from "./core/index.js";
import { handle } from "./core/ipcHandler.js";
import { TRAY_ICON_BASE64, WINDOW_ICON_BASE64 } from "./core/logoAssets.js";
import { runScan } from "./core/jobs.js";
import log, { setupLogger } from "./core/logger.js";
import { exportFrame, generateThumb } from "./core/media.js";
import { withVideoDecodeSlot } from "./core/mediaConcurrency.js";
import { withTimeout } from "./core/concurrency.js";
import { isInsideRoot } from "./core/paths.js";
import * as q from "./core/queries.js";
import type { QueryTarget } from "./core/queryExec.js";
import {
  DISPOSE_TIMEOUT_MS,
  QueryWorkerClient,
} from "./core/queryWorkerClient.js";
import { startServer } from "./core/server.js";
import * as tagAdmin from "./core/tagAdmin.js";
import * as tags from "./core/tags.js";
import type {
  DuplicatesResult,
  FileRow,
  HistoryPage,
  SearchResult,
  TagList,
  WorkspaceStats,
} from "./core/types.js";
import {
  checkForUpdates,
  getUpdateSettings,
  ignoreVersion,
  isAutoCheckEnabled,
  setAutoCheck,
  updateDownloadUrl,
} from "./core/updater.js";
import { ALL_ID, COLLECTION_ID_PREFIX, Workspaces } from "./core/workspaces.js";
import type { LogoId } from "../shared/ipc/schema.js";

// Set up logging before anything else so early failures land in the log file.
setupLogger();

// In CJS output, __dirname exists globally (out/main/).

const ws = new Workspaces();
// Heavy read-only list/search queries run on a worker thread so a slow query
// can't stall the main event loop (UI, IPC, media serving). Writes stay here.
const queryClient = new QueryWorkerClient(
  path.join(__dirname, "queryWorker.js"),
);
/** Worker-side targets for a set of Cores (the worker opens its own read-only handles). */
function queryTargets(cores: { id: string; core: Core }[]): QueryTarget[] {
  return cores.map(({ id, core }) => ({
    id,
    dbPath: path.join(core.dataDir, "db.sqlite"),
  }));
}
let mediaPort = 0;
const mediaToken = randomBytes(32).toString("base64url");
const MEDIA_TOKEN_HEADER = "X-Api-Token";
let scanSeq = 1;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Quit lifecycle. "disposing" = async teardown in flight (see before-quit),
// "done" = teardown finished (or skipped) and the quit may proceed. Any
// non-idle phase means a window close must really close instead of hiding
// to the tray, no new scans may start, and no crash recovery runs.
let quitPhase: "idle" | "disposing" | "done" = "idle";
const isQuitting = (): boolean => quitPhase !== "idle";
let mediaServer: http.Server | null = null;
let controlServer: http.Server | null = null;
let relaunchAfterQuit = false;

app.setName("Meguri");

// Only one running instance. Multiple processes would race on the same
// SQLite WAL under userData/roots/<hash>/db.sqlite and confuse the user
// (the app is tray-resident, so it's easy to launch twice by accident).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Custom URL scheme (meguri://): opening a meguri:// URL while the app is
// tray-resident brings the window to the front.
// - Linux: the .desktop file's MimeType (x-scheme-handler/meguri) makes the OS
//   spawn a second instance whose argv carries the URL; the single-instance
//   lock routes it to "second-instance" below.
// - Windows: setAsDefaultProtocolClient registers the scheme in the registry
//   (electron-builder's `protocols` covers installed builds).
// - macOS: delivered as "open-url" instead of a second instance.
const URL_SCHEME = "meguri";

app.on("second-instance", (_e, argv) => {
  const url = argv.find((a) => a.startsWith(`${URL_SCHEME}://`));
  if (url) log.info("[url-scheme] received:", url);
  if (isQuitting()) requestRelaunch();
  else showWindow();
});

/**
 * The user asked for the window while this instance is tearing down (the
 * single-instance lock made any new process exit at once). Don't swallow the
 * request: come back as a fresh process once the quit completes. Evaluated
 * in will-quit so a request landing after finalizeQuit() still counts.
 */
function requestRelaunch(): void {
  if (!relaunchAfterQuit) {
    log.info("launch requested during quit; relaunching after teardown");
  }
  relaunchAfterQuit = true;
}
app.on("will-quit", () => {
  if (!relaunchAfterQuit) return;
  relaunchAfterQuit = false;
  app.relaunch();
});

if (process.defaultApp) {
  // Dev mode (electron launched with an app path): register with explicit args
  // so the OS can route the URL back to this exact invocation.
  const appArg = process.argv[1];
  if (appArg) {
    app.setAsDefaultProtocolClient(URL_SCHEME, process.execPath, [
      path.resolve(appArg),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(URL_SCHEME);
}
app.on("open-url", (e, url) => {
  e.preventDefault();
  log.info("[url-scheme] received:", url);
  if (isQuitting()) requestRelaunch();
  else showWindow();
});

// Fast-path control endpoint. Relaying meguri:// through a second Electron
// instance costs a full AppImage mount + Chromium boot (~1s) just to pass
// argv. Instead, a tiny local HTTP server accepts "show" requests so a shell
// handler (see scripts/install-local.mjs) can raise the window in ~10ms.
// Port and token are published to <userData>/control.json (0600); the token
// is per-launch random, and the file is removed on quit so a handler hitting
// a stale file just falls back to launching the app.
function controlFilePath(): string {
  return path.join(app.getPath("userData"), "control.json");
}

function startControlServer(): Promise<http.Server | null> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const header = req.headers[MEDIA_TOKEN_HEADER.toLowerCase()];
      const token = Array.isArray(header) ? header[0] : header;
      if (token !== mediaToken) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/show") {
        log.info("[control] show requested");
        if (isQuitting()) requestRelaunch();
        else showWindow();
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.on("error", (e) => {
      log.warn("[control] server error (fast-path disabled):", e);
      resolve(null);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      try {
        // rm + write so the 0600 mode applies even if a stale file exists.
        fs.rmSync(controlFilePath(), { force: true });
        fs.writeFileSync(
          controlFilePath(),
          JSON.stringify({ port, token: mediaToken }),
          { mode: 0o600 },
        );
        log.info(`[control] listening on http://127.0.0.1:${port}`);
      } catch (e) {
        log.warn("[control] failed to write control file:", e);
      }
      resolve(server);
    });
  });
}

// Restrict in-window navigation to the bundled renderer (or the Vite dev server
// in development). Anything else is sent to the OS browser via shell.openExternal.
// setWindowOpenHandler is also applied here so a future BrowserWindow inherits it.
// `file:` is always permitted (bundled renderer); the dev origin is read on each
// call so a late-resolved ELECTRON_RENDERER_URL is honored.
function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return true;
    const dev = process.env["ELECTRON_RENDERER_URL"];
    if (dev) return u.origin === new URL(dev).origin;
    return false;
  } catch {
    return false;
  }
}
// Renderer crash recovery. A crashed renderer (OOM, a decoder fault, ...)
// otherwise leaves the tray-resident app with a blank window until the user
// quits and relaunches. Reload the main window instead — with a growing
// delay, so an OOM'd renderer isn't rebuilt before the OS has reclaimed its
// memory — and bounded per minute so a renderer that dies on every load
// cannot spin forever; past the bound the user is asked instead. Safe to
// call from this event since Electron 42.4 (it fires after teardown).
const RENDERER_RELOAD_WINDOW_MS = 60_000;
// Delay before the n-th reload within the window; its length is the bound.
const RENDERER_RELOAD_BACKOFF_MS = [0, 2_000, 5_000];
let rendererReloadTimes: number[] = [];

app.on("render-process-gone", (_e, wc, details) => {
  log.error("renderer process gone:", details);
  if (details.reason === "clean-exit" || details.reason === "killed") return;
  if (isQuitting() || !mainWindow || mainWindow.isDestroyed()) return;
  if (wc !== mainWindow.webContents) return;
  // A renderer that could not even launch, or that failed Chromium's code
  // integrity check (a DLL injected into the renderer, a tampered binary),
  // is not something to paper over with a reload: surface it instead.
  if (
    details.reason === "launch-failed" ||
    details.reason === "integrity-failure"
  ) {
    void offerRendererRecovery(details.reason);
    return;
  }
  const now = Date.now();
  rendererReloadTimes = rendererReloadTimes.filter(
    (t) => now - t < RENDERER_RELOAD_WINDOW_MS,
  );
  const attempt = rendererReloadTimes.length;
  if (attempt >= RENDERER_RELOAD_BACKOFF_MS.length) {
    log.error(
      `renderer crashed again after ${attempt} reloads within ${RENDERER_RELOAD_WINDOW_MS / 1000}s; asking the user`,
    );
    void offerRendererRecovery(details.reason);
    return;
  }
  rendererReloadTimes.push(now);
  const delay = RENDERER_RELOAD_BACKOFF_MS[attempt] ?? 0;
  log.warn(`reloading the main window after a renderer crash (in ${delay}ms)`);
  setTimeout(() => {
    if (isQuitting() || !mainWindow || mainWindow.isDestroyed()) return;
    reloadRenderer(mainWindow);
  }, delay).unref();
});

/**
 * Reload the renderer. Plain reload() would replay whatever URL is current;
 * anything that isn't the bundled app (should the navigation guards ever be
 * bypassed) is replaced by the app entry instead of being revived.
 */
function reloadRenderer(win: BrowserWindow): void {
  if (isAppUrl(win.webContents.getURL())) win.webContents.reload();
  else loadRenderer(win);
}

/** Crash-loop / integrity fallback: let the user choose instead of a blank window. */
async function offerRendererRecovery(reason: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "Meguri",
    message: "The window stopped responding and could not be recovered.",
    detail: `Reason: ${reason}. You can try reloading it, or quit Meguri.`,
    buttons: ["Reload", "Quit"],
    defaultId: 0,
    cancelId: 0,
  });
  if (isQuitting() || !mainWindow || mainWindow.isDestroyed()) return;
  if (response === 1) {
    app.quit();
    return;
  }
  rendererReloadTimes = []; // the user asked; give it a fresh budget
  reloadRenderer(mainWindow);
}
app.on("child-process-gone", (_e, details) => {
  log.error("child process gone:", details);
});

app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch {
      /* drop */
    }
  });
});

function isDevMode(): boolean {
  return !app.isPackaged;
}

function isTrayEnabled(): boolean {
  return process.env.MEGURI_DISABLE_TRAY !== "1";
}

/** Get only the root explicitly specified via CLI/env var (does not fall back to cwd). */
function resolveCliRoot(): string | null {
  if (process.env.MEGURI_ROOT) return process.env.MEGURI_ROOT;
  const appPath = app.getAppPath();
  const args = process.argv
    .slice(1)
    .filter(
      (a) => !a.startsWith("-") && a !== "." && path.resolve(a) !== appPath,
    );
  for (const a of args.reverse()) {
    try {
      if (fs.statSync(a).isDirectory()) return path.resolve(a);
    } catch {
      /* skip */
    }
  }
  return null;
}

function emit(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

// Launch an external file/URL in a fully detached child process.
// shell.openPath leaves the spawned process attached to Electron's process
// tree; on Wayland/Hyprland that makes the launched app's window a child of
// Meguri and blocks the main window until the external app closes.
// Windows uses shell.openPath directly: ShellExecuteExW doesn't reproduce the
// child-process attachment issue, and routing through cmd.exe /c start would
// open a command-injection surface for filenames containing &/|/^/( etc.
function openDetached(target: string): void {
  if (process.platform === "win32") {
    void shell.openPath(target);
    return;
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(cmd, [target], { detached: true, stdio: "ignore" });
  child.on("error", (e) => {
    log.error("[openDetached] failed to launch", cmd, target, e);
  });
  child.unref();
}

// Workspace IDs with a scan in progress. To avoid chunk-tx contention,
// concurrent scans of the same workspace are suppressed.
const scanningWs = new Set<string>();
// AbortControllers for in-progress scans, keyed by workspace ID.
const scanControllers = new Map<string, AbortController>();
// Completion promises for in-progress scans, keyed by workspace ID.
const scanPromises = new Map<string, Promise<void>>();

/** Start a scan for a single workspace's Core. Returns the job id (empty if already scanning). */
function scanCore(
  core: Core,
  wsId: string | null,
  opts: { includeExcluded?: boolean; rebuild?: boolean },
): string {
  if (isQuitting()) return ""; // shutdown() has aborted scans; don't start new ones
  if (wsId && scanningWs.has(wsId)) return ""; // don't start again if already running
  const jobId = `job-${scanSeq++}`;
  if (wsId) scanningWs.add(wsId);
  const controller = new AbortController();
  if (wsId) scanControllers.set(wsId, controller);
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
      emit("scan:done", {
        jobId,
        stats: { inserted: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0 },
        error: true,
      });
    } finally {
      if (wsId) {
        scanningWs.delete(wsId);
        scanControllers.delete(wsId);
        scanPromises.delete(wsId);
      }
      // Scans can change duplicate group membership; clear derived query caches.
      // Runs after the bookkeeping above so a failure here can never leave the
      // workspace stuck in the "scanning" state.
      await queryClient.invalidateCaches();
    }
  })();
  if (wsId) scanPromises.set(wsId, promise);
  void promise;
  return jobId;
}

async function abortScan(wsId: string): Promise<void> {
  scanControllers.get(wsId)?.abort();
  await scanPromises.get(wsId);
}

/** Abort every running scan. Resolves once they have all settled. */
function abortAllScans(): Promise<unknown> {
  for (const ctrl of scanControllers.values()) ctrl.abort();
  return Promise.allSettled([...scanPromises.values()]);
}

function startScan(
  opts: { includeExcluded?: boolean; rebuild?: boolean } = {},
): string {
  // In the virtual "All" view, scan every registered workspace concurrently
  // (each gets its own job/progress). Return the first job's id for tracking.
  if (ws.isAll()) {
    let first = "";
    for (const { id, core } of ws.allCores()) {
      const jobId = scanCore(core, id, opts);
      if (jobId && !first) first = jobId;
    }
    return first;
  }
  const core = ws.active();
  if (!core) return "";
  return scanCore(core, ws.activeId, opts);
}

// File operations are addressed by (workspaceId, fileId) since file IDs are unique
// only within a workspace. The renderer always supplies the workspace ID.
function coreById(wsId: string): Core {
  const core = ws.byId(wsId);
  if (!core) throw new Error("unknown workspace");
  return core;
}

/**
 * Take a file off Watch Later because it has now been played. Called wherever a
 * play is recorded — the in-app player's first `play` event, opening in an
 * external player, and an image's detail view (images have no player, so the
 * app already counts a view as a play). Merely opening the detail view of a
 * video does not reach here, so queueing something and peeking at its metadata
 * leaves it on the list.
 *
 * Deliberately no workspace:changed broadcast: that would refetch the list
 * behind the open detail view, dropping the very file being viewed out of the
 * prev/next navigation order mid-session. The renderer refreshes the affected
 * lists when the detail view closes instead (see MediaDetail).
 */
function consumeWatchLater(workspaceId: string, id: number): void {
  ws.removeFromWatchLater(workspaceId, id);
}

/** Resolve a file's absolute path and verify it lives under the workspace root. */
function ensureFileInsideRoot(c: Core, id: number): string {
  const abs = tags.absPathOf(c.db, id);
  if (!abs) throw new Error("file not found");
  if (!isInsideRoot(abs, c.root)) throw new Error("path is outside scan root");
  return abs;
}

function registerStatusHandlers(): void {
  handle("workspace_stats", () =>
    // Aggregate across every workspace under the virtual "All" view; for a single
    // active workspace just read its DB directly. Returns zeros/null when nothing is mounted.
    queryClient.run<WorkspaceStats>({
      kind: "stats",
      targets: queryTargets(ws.queryCores()),
    }),
  );

  handle("app_status", () => {
    if (ws.isAll()) {
      return {
        root: "All",
        ready: ws.allCores().length > 0,
        initError: null,
        initErrorKind: null,
        mediaBase: mediaPort ? `http://127.0.0.1:${mediaPort}` : null,
        workspaceId: ALL_ID,
        devMode: isDevMode(),
      };
    }
    const activeCollection = ws.activeCollection();
    if (activeCollection) {
      return {
        root: activeCollection.name,
        ready: ws.allCores().length > 0,
        initError: null,
        initErrorKind: null,
        mediaBase: mediaPort ? `http://127.0.0.1:${mediaPort}` : null,
        workspaceId: ws.activeId,
        devMode: isDevMode(),
      };
    }
    const core = ws.active();
    return {
      root: core?.root ?? null,
      ready: core != null,
      initError: ws.initError(),
      initErrorKind: ws.initErrorKind(),
      mediaBase: mediaPort ? `http://127.0.0.1:${mediaPort}` : null,
      workspaceId: ws.activeId,
      devMode: isDevMode(),
    };
  });

  // Static app/runtime versions for the Settings "About" section.
  handle("about_info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  }));
}

function registerWorkspaceHandlers(): void {
  handle("workspaces_list", () => ({
    workspaces: ws.list(),
    collections: ws.collections(),
    activeId: ws.activeId,
  }));

  handle("workspace_add", async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Add video directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return { added: false };
    const np = ws.add(res.filePaths[0]);
    ws.setActive(np);
    const scanJobId = startScan();
    emit("workspace:changed", { activeId: ws.activeId });
    return { added: true, id: Workspaces.idFor(np), scanJobId };
  });

  handle("workspace_remove", async ({ id }) => {
    const p = ws.pathOf(id);
    if (p) {
      await abortScan(id);
      // The worker holds a read-only handle on this workspace's DB; close it
      // before ws.remove() deletes the data dir (open handles block removal
      // on Windows).
      await queryClient.closeWorkspace(id);
      ws.remove(p);
    }
    if (ws.active()) startScan();
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_reorder", ({ ids }) => {
    ws.reorder(ids);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_switch", ({ id }) => {
    if (id === ALL_ID) {
      ws.setActive(ALL_ID); // the virtual "All" view is never scanned
      emit("workspace:changed", { activeId: ws.activeId });
      return;
    }
    if (id.startsWith(COLLECTION_ID_PREFIX)) {
      ws.setActive(id);
      emit("workspace:changed", { activeId: ws.activeId });
      return;
    }
    const p = ws.pathOf(id);
    if (p) ws.setActive(p);
    startScan();
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_create", ({ name, emoji }) => {
    const collection = ws.addCollection(name, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
    // addCollection makes the new collection active, so it's always the active one here.
    // User-created collections are never locked; only the built-in Watch Later is.
    return { ...collection, active: true, locked: false };
  });

  handle("collection_remove", ({ id }) => {
    ws.removeCollection(id);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_reorder", ({ ids }) => {
    ws.reorderCollections(ids);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_reorder_items", ({ collectionId, items }) => {
    ws.reorderCollectionItems(collectionId, items);
    // Deliberately no workspace:changed broadcast. The rail listens for it by
    // invalidating every files_search, which would refetch the pages the
    // renderer just patched optimistically — on every single drop. Nothing in
    // the rail depends on the order within a collection, and the renderer
    // refetches itself if the write fails. Same reasoning as consumeWatchLater.
  });

  handle("collection_set_emoji", ({ id, emoji }) => {
    ws.setCollectionEmoji(id, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_rename", ({ id, name }) => {
    ws.renameCollection(id, name);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_set_emoji", ({ id, emoji }) => {
    ws.setWorkspaceEmoji(id, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_add_file", ({ collectionId, workspaceId, id }) => {
    ws.addToCollection(collectionId, workspaceId, id);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_remove_file", ({ collectionId, workspaceId, id }) => {
    ws.removeFromCollection(collectionId, workspaceId, id);
    emit("workspace:changed", { activeId: ws.activeId });
  });
}

function registerScanHandlers(): void {
  handle("scan_start", ({ includeExcluded, rebuild }) =>
    startScan({ includeExcluded, rebuild }),
  );

  handle("scan_cancel", ({ wsId }) => {
    if (wsId) scanControllers.get(wsId)?.abort();
    else void abortAllScans();
  });
}

function registerFileHandlers(): void {
  // List queries can be invalidated by the renderer just as the active workspace
  // disappears (e.g. removing the last workspace). Return empty instead of throwing
  // so a brief race during workspace:changed doesn't surface as an error toast.
  handle("files_search", ({ query }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.allCores()),
          query,
          refs: collection.items,
        })
      : queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.queryCores()),
          query,
        });
  });
  handle("files_random", ({ query }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<FileRow[]>({
          kind: "random",
          targets: queryTargets(ws.allCores()),
          query: query ?? {},
          refs: collection.items,
        })
      : queryClient.run<FileRow[]>({
          kind: "random",
          targets: queryTargets(ws.queryCores()),
          query: query ?? {},
        });
  });
  handle("file_get", ({ id, workspaceId }) => {
    const db = coreById(workspaceId).db;
    q.recordAccess(db, id);
    return q.fileDetail(db, id);
  });
  handle("file_set_rating", ({ id, workspaceId, rating }) =>
    q.setRating(coreById(workspaceId).db, id, rating),
  );
  handle("file_set_favorite", ({ id, workspaceId, favorite }) =>
    q.setFavorite(coreById(workspaceId).db, id, favorite),
  );
  handle("file_delete_from_index", async ({ id, workspaceId }) => {
    const deleted = q.deleteFromIndex(coreById(workspaceId).db, id);
    // Await so the renderer's refetch after this resolves can't race a stale
    // duplicate-refs cache (the scan path awaits for the same reason).
    await queryClient.invalidateCaches();
    // Drop any collection refs to the now-removed file so item counts stay accurate.
    // Only broadcast when a collection actually changed; otherwise the renderer's
    // own cache invalidation after delete already covers it.
    if (ws.removeFileFromAllCollections(workspaceId, id)) {
      emit("workspace:changed", { activeId: ws.activeId });
    }
    return deleted;
  });
  handle("file_record_play", ({ id, workspaceId, via, position }) => {
    q.recordPlay(coreById(workspaceId).db, id, via, position ?? null);
    consumeWatchLater(workspaceId, id);
  });
  // A collection is a file set, not a history scope; while one is active (queryCores()
  // returns []) fall back to every workspace so the timeline is still meaningful.
  const historyCores = () =>
    ws.isCollection() ? ws.allCores() : ws.queryCores();
  handle("history_list", ({ query }) =>
    queryClient.run<HistoryPage>({
      kind: "history",
      targets: queryTargets(historyCores()),
      query: query ?? {},
    }),
  );
  // Same scope rule as history: a collection is a file set, not a duplicate
  // scope, so fall back to every workspace while one is active.
  handle("duplicates_list", () =>
    queryClient.run<DuplicatesResult>({
      kind: "duplicates",
      targets: queryTargets(historyCores()),
    }),
  );
  // Clear scope matches what history_list shows: the active workspace only, or
  // every workspace when All / a collection is active.
  handle("history_clear", () => {
    for (const { core } of historyCores()) q.clearPlayHistory(core.db);
  });
}

function registerTagHandlers(): void {
  handle("file_add_tag", ({ id, workspaceId, name }) => {
    const db = coreById(workspaceId).db;
    const tagId = tags.addManualTag(db, id, name.trim());
    tags.syncFts(db, id);
    return tagId;
  });
  handle("file_remove_tag", ({ id, workspaceId, tagId }) => {
    const db = coreById(workspaceId).db;
    tags.removeManualTag(db, id, tagId);
    tags.syncFts(db, id);
  });
  handle("tags_list", ({ workspaceId, prefix, limit }) =>
    tags.listTagNames(coreById(workspaceId).db, prefix, limit ?? 20),
  );

  // The catalog channels take no workspaceId: coreById(ALL_ID) throws by design,
  // and a tag id means nothing across databases. Scope follows the active view,
  // the same rule history_list and duplicates_list use.
  const tagCores = () => (ws.isCollection() ? ws.allCores() : ws.queryCores());

  /** Cores for a catalog mutation. allCores() silently skips workspaces whose DB
   *  could not be opened, which for a rename means that workspace keeps the old
   *  name while the others move on — worth a line in the log when it happens. */
  const tagMutationCores = () => {
    const cores = tagCores();
    const expected =
      ws.isCollection() || ws.isAll() ? ws.rootCount() : cores.length;
    if (cores.length < expected) {
      log.warn(
        `tag mutation covers ${cores.length}/${expected} workspaces; the rest could not be opened`,
      );
    }
    return cores;
  };

  handle("tags_list_all", () =>
    queryClient.run<TagList>({
      kind: "tagsList",
      targets: queryTargets(tagCores()),
    }),
  );
  // Mutations are addressed by name, so fanning them across every database in
  // scope converges on the same end state even when one of them has a collision
  // (rename there escalates to a merge) and another does not.
  handle("tag_rename", ({ from, to }) => {
    let merged = false;
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      const r = tagAdmin.renameTag(core.db, from, to);
      merged ||= r.merged;
      affectedFiles += r.affectedFiles;
    }
    return { merged, affectedFiles };
  });
  handle("tag_merge", ({ from, into }) => {
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      affectedFiles += tagAdmin.mergeTags(core.db, from, into).affectedFiles;
    }
    return { affectedFiles };
  });
  handle("tag_delete", ({ tags: refs }) => {
    let removedTags = 0;
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      const r = tagAdmin.deleteTags(core.db, refs);
      removedTags += r.removedTags;
      affectedFiles += r.affectedFiles;
    }
    return { removedTags, affectedFiles };
  });
}

function registerBookmarkHandlers(): void {
  handle("bookmark_add", ({ id, workspaceId, sec }) =>
    q.addBookmark(coreById(workspaceId).db, id, sec),
  );
  handle("bookmark_remove", ({ id, workspaceId, bookmarkId }) =>
    q.removeBookmark(coreById(workspaceId).db, id, bookmarkId),
  );
}

function registerThumbHandlers(): void {
  // Custom main thumbnail: regenerate the on-disk WebP from the given offset (video only).
  // Passing sec=null reverts to the auto-extracted frame.
  handle("thumb_set_offset", async ({ id, workspaceId, sec }) => {
    const c = coreById(workspaceId);
    const file = c.db
      .prepare(
        "SELECT abs_path AS absPath, kind, duration FROM files WHERE id = ? AND deleted_at IS NULL",
      )
      .get(id) as
      { absPath: string; kind: string; duration: number | null } | undefined;
    if (!file) throw new Error("file not found");
    if (file.kind !== "video")
      throw new Error("custom thumbnail is only supported for videos");
    if (!isInsideRoot(file.absPath, c.root))
      throw new Error("path is outside scan root");
    if (sec != null) {
      if (!Number.isFinite(sec) || sec < 0) {
        throw new Error("invalid offset");
      }
      if (file.duration != null && sec >= file.duration) {
        throw new Error("offset exceeds video duration");
      }
    }
    // Regenerate FIRST so we never persist an offset whose frame couldn't be extracted.
    // On failure, leave file_meta.thumb_offset_sec untouched and surface the error to the
    // renderer; the UI will roll back its optimistic update.
    const dest = path.join(c.thumbsDir(), `${id}.webp`);
    const ok = await withVideoDecodeSlot(() =>
      generateThumb(file.absPath, "video", dest, undefined, sec ?? undefined),
    );
    if (!ok)
      throw new Error("failed to generate thumbnail at the requested offset");
    q.setThumbOffset(c.db, id, sec);
    q.setThumb(c.db, id, dest, "done");
    emit("thumb:done", { id, workspaceId });
    return { ok: true, thumbOffsetSec: sec };
  });

  // Export the frame at `sec` as a full-resolution still image via a native
  // save dialog. Dialog cancellation is a normal outcome (saved=false).
  // Serialized: a rapid double-click can invoke twice before the renderer's
  // pending state disables the button, and stacking two modal save dialogs
  // would be confusing — treat re-entry like a cancel.
  let frameExportInFlight = false;
  handle("frame_export", async ({ id, workspaceId, sec }) => {
    if (frameExportInFlight) return { saved: false, path: null };
    frameExportInFlight = true;
    try {
      const c = coreById(workspaceId);
      const abs = ensureFileInsideRoot(c, id);
      const base = path.parse(abs).name;
      // Colons aren't filesystem-safe, so the timestamp uses dashes (hh-mm-ss).
      const whole = Math.floor(sec);
      const stamp = [
        Math.floor(whole / 3600),
        Math.floor((whole % 3600) / 60),
        whole % 60,
      ]
        .map((n) => String(n).padStart(2, "0"))
        .join("-");
      // Default to the OS pictures folder, not the video's own directory —
      // that one lives inside the scan root, and an image saved there would be
      // indexed into the library on the next scan. getPath can throw on Linux
      // when the XDG pictures dir is undefined; fall back to home.
      let picturesDir: string;
      try {
        picturesDir = app.getPath("pictures");
      } catch {
        picturesDir = app.getPath("home");
      }
      const res = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: "Export frame",
        defaultPath: path.join(picturesDir, `${base}_${stamp}.png`),
        filters: [
          { name: "PNG", extensions: ["png"] },
          { name: "JPEG", extensions: ["jpg", "jpeg"] },
        ],
      });
      if (res.canceled || !res.filePath) return { saved: false, path: null };
      const ext = path.extname(res.filePath).toLowerCase();
      const format = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png";
      // ffmpeg infers the output muxer from the extension; replace an unknown
      // (or missing) extension with .png so extraction can't fail on that.
      let dest = res.filePath;
      if (format === "png" && ext !== ".png") {
        const stem = ext ? res.filePath.slice(0, -ext.length) : res.filePath;
        dest = `${stem}.png`;
        // The dialog's overwrite prompt only covered the name as typed; never
        // silently clobber a different existing file after rewriting it.
        for (let n = 1; fs.existsSync(dest); n++) dest = `${stem} (${n}).png`;
      }
      const ok = await withVideoDecodeSlot(() =>
        exportFrame(abs, dest, sec, format),
      );
      if (!ok) throw new Error("failed to export frame");
      return { saved: true, path: dest };
    } finally {
      frameExportInFlight = false;
    }
  });
}

function registerShellHandlers(): void {
  handle("open_external", ({ id, workspaceId }) => {
    const c = coreById(workspaceId);
    const abs = ensureFileInsideRoot(c, id);
    openDetached(abs);
    q.recordPlay(c.db, id, "external", null);
    consumeWatchLater(workspaceId, id);
  });

  handle("open_folder", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(workspaceId), id);
    shell.showItemInFolder(abs);
  });

  handle("copy_file_path", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(workspaceId), id);
    clipboard.writeText(abs);
  });

  // Open an arbitrary external URL (e.g. the support/donation link). Only
  // http(s) plus the MS Store deep link (update notification on Store installs)
  // are allowed.
  handle("open_url", ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("invalid url");
    }
    const allowed = ["http:", "https:", "ms-windows-store:"];
    if (!allowed.includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    void shell.openExternal(parsed.toString());
  });

  handle("open_devtools", () => {
    if (!isDevMode()) return false;
    mainWindow?.webContents.openDevTools({ mode: "right" });
    return true;
  });

  // Close the window from the renderer (Esc on the bare list screen). Goes
  // through close() so the tray-hide behavior in the "close" handler applies.
  handle("window_close", () => {
    mainWindow?.close();
  });
}

function trayImage(logo: LogoId): Electron.NativeImage {
  return nativeImage.createFromDataURL(
    `data:image/png;base64,${TRAY_ICON_BASE64[logo]}`,
  );
}

function windowImage(logo: LogoId): Electron.NativeImage {
  return nativeImage.createFromDataURL(
    `data:image/png;base64,${WINDOW_ICON_BASE64[logo]}`,
  );
}

/**
 * Re-apply the logo variant to the live tray and window/dock icons.
 *
 * Live switches always use the embedded 256px bitmap, including a switch back
 * to the default: there is no Electron API to restore the packaged icon on a
 * live window/dock. The full-resolution packaged icon (.ico/.icns/.desktop)
 * comes back on the next launch, where startup skips the override for the
 * default logo.
 */
function applyLogo(logo: LogoId): void {
  tray?.setImage(trayImage(logo));
  if (process.platform === "darwin") {
    // BrowserWindow icons are ignored on macOS; the dock icon is the app icon.
    app.dock?.setIcon(windowImage(logo));
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(windowImage(logo));
  }
}

function registerLogoHandlers(): void {
  handle("logo_get", () => loadConfig().logo);
  handle("logo_set", ({ logo }) => {
    updateConfig((c) => ({ ...c, logo }));
    applyLogo(logo);
    return logo;
  });
}

function registerUpdateHandlers(): void {
  handle("update_check", ({ force }) => checkForUpdates({ force }));
  handle("update_get_settings", () => getUpdateSettings());
  handle("update_set_auto_check", ({ enabled }) => {
    setAutoCheck(enabled);
  });
  handle("update_ignore", ({ version }) => {
    ignoreVersion(version);
  });
}

/**
 * On startup, check GitHub for a newer stable release (when auto-check is on)
 * and push an event to the renderer if one is available. Deferred so it never
 * competes with the initial scan/render, and failures are swallowed (it's a
 * best-effort convenience, not a critical path).
 */
function scheduleStartupUpdateCheck(): void {
  if (!isAutoCheckEnabled()) return;
  setTimeout(() => {
    void checkForUpdates()
      .then((info) => {
        if (info?.available) emit("update:available", info);
      })
      .catch((e) => log.warn("startup update check failed", e));
  }, 8_000);
}

function registerIpc(): void {
  registerStatusHandlers();
  registerWorkspaceHandlers();
  registerScanHandlers();
  registerFileHandlers();
  registerTagHandlers();
  registerBookmarkHandlers();
  registerThumbHandlers();
  registerShellHandlers();
  registerUpdateHandlers();
  registerLogoHandlers();
}

function createWindow(): void {
  const { logo } = loadConfig();
  rendererReloadTimes = []; // a fresh window gets a fresh crash budget
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: "Meguri",
    // Window/taskbar icon (Linux/Windows; macOS uses the dock icon instead).
    // Only overridden for non-default logos: the packaged multi-size icon
    // (exe-embedded .ico / .desktop entry) stays in charge for the default,
    // and it carries more sizes than the embedded bitmap.
    ...(logo !== DEFAULT_LOGO ? { icon: windowImage(logo) } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: isDevMode(),
    },
  });

  // Window-open / will-navigate are governed globally via app.on("web-contents-created").

  // Closing the window hides it to the tray unless tray support is disabled.
  mainWindow.on("close", (e) => {
    if (isTrayEnabled() && !isQuitting()) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Windows shutdown / restart / log-off never reaches before-quit; this is
  // the only notice the app gets before the OS kills it.
  mainWindow.on("session-end", () => {
    log.info("session ending; tearing down synchronously");
    teardownSync();
  });

  loadRenderer(mainWindow);
}

/** Load the app entry (dev server in development, bundled renderer otherwise). */
function loadRenderer(win: BrowserWindow): void {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

/** Show and focus the main window, recreating it if it was destroyed. */
function showWindow(): void {
  if (isQuitting()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (!isTrayEnabled()) return;
  tray = new Tray(trayImage(loadConfig().logo));
  tray.setToolTip("Meguri");
  const menu = Menu.buildFromTemplate([
    { label: "Show Meguri", click: () => showWindow() },
    {
      label: "Check for Updates…",
      click: () => {
        void checkForUpdates({ force: true })
          .then((info) => {
            if (info?.available) {
              showWindow();
              emit("update:available", info);
            } else if (info) {
              // Reached GitHub and we're current: take the user to the releases
              // page (or the Store product page on Store installs).
              void shell.openExternal(updateDownloadUrl(null));
            } else {
              // Couldn't reach GitHub (offline / rate-limited): don't silently
              // open a browser; tell the user the check failed.
              void dialog.showMessageBox({
                type: "warning",
                title: "Meguri",
                message: "Could not check for updates.",
                detail: "Please check your internet connection and try again.",
              });
            }
          })
          .catch((e) => log.warn("manual update check failed", e));
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  // Left-click toggles window visibility (no-op on platforms that don't emit it).
  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
}

function installMediaAuthHeader(): void {
  if (!mediaPort) return;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`http://127.0.0.1:${mediaPort}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [MEDIA_TOKEN_HEADER]: mediaToken,
        },
      });
    },
  );
}

async function installReactDevTools(): Promise<void> {
  if (!isDevMode()) return;
  try {
    const { default: installExtension, REACT_DEVELOPER_TOOLS } =
      await import("electron-devtools-installer");
    const extension = await installExtension(REACT_DEVELOPER_TOOLS, {
      loadExtensionOptions: { allowFileAccess: true },
    });
    log.info(`Added Extension: ${extension.name}`);
  } catch (err) {
    log.warn("React DevTools extension could not be installed", err);
  }
}

void app.whenReady().then(async () => {
  // Completely remove the native app menu (File/Edit/View…).
  Menu.setApplicationMenu(null);

  ws.bootstrap(resolveCliRoot());

  // The media server resolves the DB by workspace ID to serve (independent of the active one).
  ({ port: mediaPort, server: mediaServer } = await startServer(
    (id) => ws.byId(id),
    mediaToken,
  ));
  installMediaAuthHeader();
  log.info(`media server on http://127.0.0.1:${mediaPort}`);

  controlServer = await startControlServer();

  // System shutdown / reboot (macOS, Linux): no time for the async gate.
  powerMonitor.on("shutdown", () => {
    log.info("system shutting down; tearing down synchronously");
    teardownSync();
    app.quit();
  });

  registerIpc();
  createTray();
  // Dock icon override on macOS (BrowserWindow icons are ignored there).
  // Skipped for the default logo so the packaged .icns keeps its full
  // resolution set.
  if (process.platform === "darwin" && loadConfig().logo !== DEFAULT_LOGO) {
    applyLogo(loadConfig().logo);
  }
  await installReactDevTools();
  createWindow();
  if (isDevMode()) {
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      mainWindow?.webContents.openDevTools({ mode: "right" });
    });
  }
  startScan();
  scheduleStartupUpdateCheck();

  app.on("activate", () => showWindow());
});

// Async teardown before quit: leave no live better-sqlite3 handle behind
// (worker read-only handles, the main-thread fallback, and the per-workspace
// writers), since unloading the native addon over open connections is a
// crash risk on exit. Order: abort scans and let them drain (their in-flight
// ffmpeg runs are killed by the signal, so this is short — and bounded, since
// a stuck scan must not stall quit), then dispose the query worker. The
// writers are closed by the quit gate's finally below, so that step runs even
// when the budget cuts this short.
// Teardown is three steps, in this order, on every quit path:
//   1. stopIntake()   — sync: hide the window, stop the local servers, abort
//                       scans. Nothing new gets in after this.
//   2. drain          — async (shutdown() only): wait, bounded, for scans to
//                       settle and for the query worker to close its handles.
//   3. finalizeQuit() — sync: close the writers, refuse reopening, remove the
//                       control file. Always runs, even when 2 was cut short.
// The async gate (before-quit below) runs 1→2→3; the synchronous paths
// (teardownSync) run 1→3 with the worker torn down fire-and-forget.
const SHUTDOWN_SCAN_WAIT_MS = 1_000;

function stopIntake(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  mediaServer?.close();
  controlServer?.close();
}

async function shutdown(): Promise<void> {
  stopIntake();
  await withTimeout(abortAllScans(), SHUTDOWN_SCAN_WAIT_MS);
  await queryClient.dispose();
}

function finalizeQuit(): void {
  quitPhase = "done";
  // Guarded so that a throw here can never leave quitPhase stuck (which
  // would make the app impossible to quit).
  try {
    ws.closeAll();
  } catch (e) {
    log.error("closing workspaces on quit failed:", e);
  }
  try {
    fs.rmSync(controlFilePath(), { force: true });
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Tear down right now, without waiting for anything. Used where the async
 * gate isn't an option: the OS is ending the session, or (macOS) before-quit
 * runs inside applicationShouldTerminate, where cancelling the quit to wait
 * would also cancel a log-out or shutdown in progress. On these paths the
 * worker thread is only *being* terminated at exit (terminateNow), not
 * confirmed closed — the best a synchronous path can do.
 */
function teardownSync(): void {
  if (quitPhase === "done") return;
  quitPhase = "disposing";
  stopIntake();
  void abortAllScans();
  queryClient.terminateNow();
  finalizeQuit();
}

// Quit gate. Electron does not await async listeners, so the first pass
// cancels the quit, runs shutdown(), then re-enters app.quit(). A repeated
// quit request while that is in flight is absorbed rather than started over.
// The budget here is a backstop over shutdown()'s own bounds (scan drain +
// worker dispose), derived from them so it always stays above their sum and
// the normal path completes before it fires.
const QUIT_BUDGET_MS = SHUTDOWN_SCAN_WAIT_MS + DISPOSE_TIMEOUT_MS + 2_000;
app.on("before-quit", (e) => {
  globalShortcut.unregisterAll();
  if (quitPhase === "done") return;
  if (process.platform === "darwin") {
    // See teardownSync(): preventDefault() here would cancel an OS log-out.
    teardownSync();
    return;
  }
  e.preventDefault();
  if (quitPhase === "disposing") return;
  quitPhase = "disposing";
  void withTimeout(shutdown(), QUIT_BUDGET_MS)
    .catch(() => {})
    .finally(() => {
      // Runs on the timeout path too: the writers get closed regardless, and
      // nothing can reopen them afterwards (Workspaces refuses).
      finalizeQuit();
      app.quit();
    });
});

// With tray support enabled, closing windows keeps the app resident.
// Without tray support (e.g. Docker), closing the last window quits.
app.on("window-all-closed", () => {
  if (!isTrayEnabled()) app.quit();
  /* keep running in tray */
});
