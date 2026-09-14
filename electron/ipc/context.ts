// What the IPC handler groups need from the main process. main.ts owns the
// live state (window, tray, media server, scan bookkeeping) and hands the
// groups this narrow view of it, so a handler never reaches into main.ts and
// the groups can be registered — and read — one domain at a time. Helpers
// shared by the groups live in helpers.ts.
import type { BrowserWindow } from "electron";
import type { QueryWorkerClient } from "../core/queryWorkerClient.js";
import type { Workspaces } from "../core/workspaces.js";
import type { LogoId } from "../../shared/ipc/schema.js";

export interface ScanOptions {
  includeExcluded?: boolean;
  rebuild?: boolean;
}

export interface IpcContext {
  ws: Workspaces;
  queryClient: QueryWorkerClient;
  // Function-typed properties rather than methods: the groups destructure
  // these freely, and none of them relies on `this`.
  /** Live values, read on each call: they change after registration. */
  mainWindow: () => BrowserWindow | null;
  mediaBase: () => string | null;
  isDevMode: () => boolean;
  /** Send an event to the renderer (no-op when the window is gone). */
  emit: (channel: string, payload: unknown) => void;
  /** Scan the active workspace(s); returns the first job id ("" if none started). */
  startScan: (opts?: ScanOptions) => string;
  /** Abort one workspace's scan and wait for it to settle. */
  abortScan: (wsId: string) => Promise<void>;
  /** Abort every running scan without waiting. */
  abortAllScans: () => Promise<unknown>;
  /** Request cancellation of one workspace's scan (fire-and-forget). */
  cancelScan: (wsId: string) => void;
  /** Re-apply the logo variant to the live tray and window/dock icons. */
  applyLogo: (logo: LogoId) => void;
}
