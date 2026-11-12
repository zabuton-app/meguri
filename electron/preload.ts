// preload: expose a minimal, safe IPC bridge to the renderer.
import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
// Side-effect import: bridges `electron-log/renderer` calls from the sandboxed
// renderer to the main process via its own dedicated IPC channels
// (__ELECTRON_LOG__ / __ELECTRON_LOG_IPC__). Independent of the API whitelist below.
import "electron-log/preload";
import {
  APP_GLYPH_ARG,
  APP_NAME_ARG,
  EVENT_CHANNELS as EVENT_CHANNEL_NAMES,
  INVOKE_CHANNELS as INVOKE_CHANNEL_NAMES,
  type PreloadInvokeChannel,
} from "../shared/ipc/channelNames.js";

// Whitelist of allowed IPC channel names. The preload is the security boundary
// between the renderer and the main process; without this check, a renderer-side
// XSS (or a compromised dependency) could call any ipcMain.handle channel.
// Lists are sourced from shared/ipc/channelNames.ts (same as channels.ts).
const INVOKE_CHANNELS = new Set<string>(INVOKE_CHANNEL_NAMES);
const EVENT_CHANNELS = new Set<string>(EVENT_CHANNEL_NAMES);

/** The value main passed as `<prefix><value>` (additionalArguments). */
function argValue(prefix: string): string {
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    ""
  );
}

contextBridge.exposeInMainWorld("api", {
  /** The app's name and one-character mark, as passed to startApp() (electron/app.ts). */
  appName: argValue(APP_NAME_ARG),
  appGlyph: argValue(APP_GLYPH_ARG),
  /** Command invocation (maps to ipcMain.handle). */
  invoke: (channel: string, args?: unknown) => {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, args);
  },
  /** Event subscription. Call the return value to unsubscribe. */
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC event channel not allowed: ${channel}`);
    }
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /** Content zoom factor (native zoom). Unlike CSS zoom, it doesn't break coordinate calculations. */
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
  /**
   * Register a folder dropped from the OS as a workspace. The File's path is
   * resolved here and handed straight to main, so the renderer never sees or
   * supplies a raw filesystem path; "workspace_add_path" is deliberately not on
   * the INVOKE_CHANNELS whitelist above. Main checks the path is a directory.
   */
  addDroppedWorkspace: (file: File) =>
    ipcRenderer.invoke("workspace_add_path" satisfies PreloadInvokeChannel, {
      path: webUtils.getPathForFile(file),
    }),
});
