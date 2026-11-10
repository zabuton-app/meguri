import { clipboard, nativeImage, shell } from "electron";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { handle } from "../core/ipcHandler.js";
import log from "../core/logger.js";
import { TRAY_ICON_BASE64 } from "../core/logoAssets.js";
import { folderDirInsideRoot, folderPathUnderRoot } from "../core/paths.js";
import * as q from "../core/queries.js";
import type { IpcContext } from "./context.js";
import { bulkTargetCores, coreById, ensureFileInsideRoot } from "./helpers.js";

// Launch an external file/URL in a fully detached child process.
// shell.openPath leaves the spawned process attached to Electron's process
// tree; on Wayland/Hyprland that makes the launched app's window a child of
// Meguri and blocks the main window until the external app closes.
// Windows uses shell.openPath directly: ShellExecuteExW doesn't reproduce the
// child-process attachment issue, and routing through cmd.exe /c start would
// open a command-injection surface for filenames containing &/|/^/( etc.
export function openDetached(target: string): void {
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

  handle("drag_files", (targets, event) => {
    const files = bulkTargetCores(ws, targets).flatMap(({ core, fileIds }) =>
      fileIds.map((id) => {
        const file = ensureFileInsideRoot(core, id);
        if (!statSync(file).isFile()) throw new Error("file not found");
        return file;
      }),
    );
    // Resolve the entire selection before starting the OS drag. A stale or
    // out-of-root entry must not silently turn this into a partial drag.
    const icon = nativeImage.createFromBuffer(
      Buffer.from(TRAY_ICON_BASE64.dark, "base64"),
    );
    event.sender.startDrag({
      file: files[0],
      files: [...new Set(files)],
      icon,
    });
  });

  // A folder of the folder view, in the default file manager. Opened detached
  // like a media file (see openDetached): xdg-open/open/Explorer all hand a
  // directory to the file manager. Windows' openPath reports failure as a
  // string rather than rejecting, so it is checked here for the renderer to
  // show; the detached spawn elsewhere cannot report back and only logs.
  handle("folder_open_in_file_manager", async ({ workspaceId, path }) => {
    const c = coreById(ws, workspaceId);
    const dir = folderDirInsideRoot(c.root, path);
    if (!dir) throw new Error("folder not found");
    if (process.platform === "win32") {
      const error = await shell.openPath(dir);
      if (error) throw new Error(error);
      return;
    }
    openDetached(dir);
  });

  // The folder's path as the user knows it (the configured root, links left
  // as they are), once it is confirmed to be a real directory inside the root.
  // clipboard.writeText returns a promise since Electron 45: awaited, so a
  // failure reaches the renderer instead of going unhandled.
  handle("folder_copy_path", async ({ workspaceId, path }) => {
    const c = coreById(ws, workspaceId);
    if (!folderDirInsideRoot(c.root, path)) throw new Error("folder not found");
    await clipboard.writeText(folderPathUnderRoot(c.root, path));
  });

  handle("copy_file_path", async ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(ws, workspaceId), id);
    await clipboard.writeText(abs);
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
