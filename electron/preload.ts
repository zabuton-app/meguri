// preload: expose a minimal, safe IPC bridge to the renderer.
import { contextBridge, ipcRenderer, webFrame } from "electron";
// Side-effect import: bridges `electron-log/renderer` calls from the sandboxed
// renderer to the main process via its own dedicated IPC channels
// (__ELECTRON_LOG__ / __ELECTRON_LOG_IPC__). Independent of the API whitelist below.
import "electron-log/preload";
import {
  EVENT_CHANNELS as EVENT_CHANNEL_NAMES,
  INVOKE_CHANNELS as INVOKE_CHANNEL_NAMES,
} from "../shared/ipc/channelNames.js";

// Whitelist of allowed IPC channel names. The preload is the security boundary
// between the renderer and the main process; without this check, a renderer-side
// XSS (or a compromised dependency) could call any ipcMain.handle channel.
// Lists are sourced from shared/ipc/channelNames.ts (same as channels.ts).
const INVOKE_CHANNELS = new Set<string>(INVOKE_CHANNEL_NAMES);
const EVENT_CHANNELS = new Set<string>(EVENT_CHANNEL_NAMES);

contextBridge.exposeInMainWorld("api", {
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
});
