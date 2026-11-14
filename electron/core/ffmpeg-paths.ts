// Resolved paths to bundled ffmpeg / ffprobe binaries. When packaged in asar,
// native binaries live in app.asar.unpacked (see electron-builder asarUnpack),
// so the static paths need rewriting at runtime.
import { ffmpegPath, ffprobePath } from "@zabuton-app/ffmpeg-binaries";

function unpacked(p: string): string {
  return p.replace("app.asar", "app.asar.unpacked");
}

export const FFMPEG = unpacked(ffmpegPath || "ffmpeg");
export const FFPROBE = unpacked(ffprobePath || "ffprobe");
