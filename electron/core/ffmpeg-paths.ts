// Resolved paths to the bundled ffmpeg / ffprobe binaries, or to the system
// ones when a package names their directory. When packaged in asar, native
// binaries live in app.asar.unpacked (see electron-builder asarUnpack), so the
// static paths need rewriting at runtime.
import path from "node:path";
import { ffmpegPath, ffprobePath } from "@zabuton-app/ffmpeg-binaries";

function unpacked(p: string): string {
  return p.replace("app.asar", "app.asar.unpacked");
}

/** The bundled executable, or the one in `systemDir`: a package that depends
 *  on the system FFmpeg (and installs with ZABUTON_FFMPEG_SKIP_DOWNLOAD=1)
 *  names the directory in MEGURI_FFMPEG_DIR. Set explicitly rather than
 *  inferred from a missing bundled file, so a build that lost its bundled
 *  FFmpeg by mistake still fails visibly, and ffmpeg and ffprobe always come
 *  from the same place. */
export function toolPath(
  bundled: string | null,
  name: string,
  systemDir: string | undefined = process.env.MEGURI_FFMPEG_DIR,
): string {
  if (systemDir) return path.join(systemDir, name);
  return unpacked(bundled || name);
}

export const FFMPEG = toolPath(ffmpegPath, "ffmpeg");
export const FFPROBE = toolPath(ffprobePath, "ffprobe");
