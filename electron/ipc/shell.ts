import { clipboard, shell } from "electron";
import { handle } from "../core/ipcHandler.js";
import * as q from "../core/queries.js";
import type { IpcContext } from "./context.js";
import { coreById, ensureFileInsideRoot, openDetached } from "./helpers.js";

export function registerShellHandlers(ctx: IpcContext): void {
  const { ws } = ctx;

  handle("open_external", ({ id, workspaceId }) => {
    const c = coreById(ws, workspaceId);
    const abs = ensureFileInsideRoot(c, id);
    openDetached(abs);
    q.recordPlay(c.db, id, "external", null);
    ws.removeFromWatchLater(workspaceId, id);
  });

  handle("open_folder", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(ws, workspaceId), id);
    shell.showItemInFolder(abs);
  });

  handle("copy_file_path", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(ws, workspaceId), id);
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
    if (!ctx.isDevMode()) return false;
    ctx.mainWindow()?.webContents.openDevTools({ mode: "right" });
    return true;
  });

  // Close the window from the renderer (Esc on the bare list screen). Goes
  // through close() so the tray-hide behavior in the "close" handler applies.
  handle("window_close", () => {
    ctx.mainWindow()?.close();
  });
}
