import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { handle } from "../core/ipcHandler.js";
import { exportFrame, generateThumb } from "../core/media.js";
import { withVideoDecodeSlot } from "../core/mediaConcurrency.js";
import { isInsideRoot } from "../core/paths.js";
import * as q from "../core/queries.js";
import type { IpcContext } from "./context.js";
import { coreById, ensureFileInsideRoot } from "./helpers.js";

export function registerThumbHandlers(ctx: IpcContext): void {
  const { ws, emit } = ctx;

  // Custom main thumbnail: regenerate the on-disk WebP from the given offset (video only).
  // Passing sec=null reverts to the auto-extracted frame.
  handle("thumb_set_offset", async ({ id, workspaceId, sec }) => {
    const c = coreById(ws, workspaceId);
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
      const c = coreById(ws, workspaceId);
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
      const res = await dialog.showSaveDialog(ctx.mainWindow() ?? undefined!, {
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
