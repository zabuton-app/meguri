// Resolved paths to bundled ffmpeg / ffprobe binaries. When packaged in asar,
// native binaries live in app.asar.unpacked (see electron-builder asarUnpack),
// so the static paths need rewriting at runtime.
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

function unpacked(p: string): string {
  return p.replace("app.asar", "app.asar.unpacked");
}

export const FFMPEG = unpacked((ffmpegStatic as unknown as string) || "ffmpeg");
export const FFPROBE = unpacked(ffprobeStatic.path || "ffprobe");
