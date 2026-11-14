// What the IPC handler groups need from the main process. app.ts owns the
// live state (window, tray, media server) plus the ScanManager, and hands the
// groups this narrow view of it, so a handler never reaches into app.ts and
// the groups can be registered — and read — one domain at a time. Helpers
// shared by the groups live in helpers.ts.
import type { BrowserWindow } from "electron";
import type { DeriveAutoTags } from "../core/autoTagDeriver.js";
import type { PositionWriter } from "../core/positionWriter.js";
import type { QueryWorkerClient } from "../core/queryWorkerClient.js";
import type { WorkspacePasses } from "../core/workspacePasses.js";
import type { Workspaces } from "../core/workspaces.js";
import type { ScanManager } from "../scanManager.js";
import type { LogoId } from "../../shared/ipc/schema.js";
import type { LogoImages } from "../app.js";

export interface IpcContext {
  ws: Workspaces;
  queryClient: QueryWorkerClient;
  /** Coalesces playback-position writes; flushed on quit by app.ts. */
  positions: PositionWriter;
  // Function-typed properties rather than methods: the groups destructure
  // these freely, and none of them relies on `this`.
  /** Live values, read on each call: they change after registration. */
  mainWindow: () => BrowserWindow | null;
  mediaBase: () => string | null;
  isDevMode: () => boolean;
  /** Send an event to the renderer (no-op when the window is gone). */
  emit: (channel: string, payload: unknown) => void;
  /** Starts and aborts scans; owns the scan state. */
  scans: ScanManager;
  /** Re-apply the logo variant to the live tray and window/dock icons. */
  applyLogo: (logo: LogoId) => void;
  /** The app's logo bitmaps, from startApp()'s options. */
  logos: LogoImages;
  /** Evaluates the auto-tagging engine off the main thread. */
  deriveAutoTags: DeriveAutoTags;
  /**
   * Where passes over every workspace outside a scan run ("Apply to existing
   * files", and any new one of that kind), so that a workspace's removal and
   * quitting can stop them and wait.
   */
  passes: WorkspacePasses;
  /** Merge the workspaces the last merge into the library could not, again,
   *  with the progress shown as at startup. */
  retryLibraryMerge: () => Promise<void>;
  /** When the library copy put back at startup was taken (Unix seconds), or
   *  null when the library was sound. */
  libraryRestoredFrom: () => number | null;
}
