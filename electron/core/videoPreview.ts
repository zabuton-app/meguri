import { execFile } from "node:child_process";
import { FFMPEG } from "./ffmpeg-paths.js";

const PREVIEW_SCALE =
  "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";

export function videoPreviewFilter(toneMap: boolean): string {
  if (!toneMap) return PREVIEW_SCALE;
  // Scale in 10-bit before the more expensive linear-light conversion.
  return [
    PREVIEW_SCALE,
    "format=yuv422p10le",
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=mobius:desat=2",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/** Takes the already-probed JSON (files.meta, parsed). */
export function isTaggedHdr(raw: unknown): boolean {
  const streams = (
    raw as {
      streams?: unknown;
    } | null
  )?.streams;
  if (!Array.isArray(streams)) return false;
  // Use the same first video stream as FFmpeg's 0:V:0 map. Leave SDR and
  // missing or unrecognized color metadata on the regular preview path.
  const video = (
    streams as ({
      codec_type?: string;
      color_transfer?: string;
      color_primaries?: string;
      color_space?: string;
      disposition?: { attached_pic?: number };
    } | null)[]
  ).find(
    (stream) =>
      stream?.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  return (
    (video?.color_transfer === "smpte2084" ||
      video?.color_transfer === "arib-std-b67") &&
    (video.color_primaries === "bt2020" ||
      video.color_primaries === "smpte432" ||
      video.color_primaries === "bt709") &&
    (video.color_space === "bt2020nc" ||
      video.color_space === "bt2020c" ||
      video.color_space === "bt709")
  );
}

export type PreviewEncoder = "libx264" | "h264_videotoolbox";

/** Picks the H.264 encoder for previews from `ffmpeg -encoders` output.
 *  libx264 is GPL, so an FFmpeg built without --enable-gpl (or a system one
 *  that leaves it out) does not have it; on macOS, VideoToolbox stands in. */
export function pickPreviewEncoder(encoders: string): PreviewEncoder | null {
  if (/^ V\S* libx264 /m.test(encoders)) return "libx264";
  if (/^ V\S* h264_videotoolbox /m.test(encoders)) return "h264_videotoolbox";
  return null;
}

export function previewEncoderArgs(encoder: PreviewEncoder): string[] {
  if (encoder === "h264_videotoolbox")
    return [
      "-c:v",
      "h264_videotoolbox",
      // The software encoder covers a Mac without the hardware one (a VM).
      "-allow_sw",
      "1",
      // VideoToolbox's default bitrate is low enough to smear a 1080p picture.
      "-b:v",
      "8M",
    ];
  return ["-c:v", "libx264", "-preset", "ultrafast", "-threads:v", "2"];
}

let previewEncoderChoice: Promise<PreviewEncoder> | undefined;

export function previewEncoder(): Promise<PreviewEncoder> {
  // Check once, on the first preview, like supportsToneMapping.
  return (previewEncoderChoice ??= new Promise((resolve) => {
    execFile(
      FFMPEG,
      ["-hide_banner", "-encoders"],
      { timeout: 3000 },
      (error, stdout) => {
        // A failed check is asked again on the next preview; until then the
        // preview keeps the encoder it always used.
        if (error) {
          previewEncoderChoice = undefined;
          resolve("libx264");
          return;
        }
        // Neither: keep the encoder previews always used, and fail as before.
        resolve(pickPreviewEncoder(stdout) ?? "libx264");
      },
    );
  }));
}

let toneMappingSupport: Promise<boolean> | undefined;

export function supportsToneMapping(): Promise<boolean> {
  // Some FFmpeg builds omit zscale. Check once, on the first tagged HDR clip.
  return (toneMappingSupport ??= new Promise((resolve) => {
    execFile(
      FFMPEG,
      ["-hide_banner", "-filters"],
      { timeout: 3000 },
      (error, stdout) => {
        // A failed check (a busy start-up hitting the timeout) is asked again
        // on the next HDR clip; only a real filter list is remembered.
        if (error) toneMappingSupport = undefined;
        resolve(
          !error &&
            /\s+zscale\s+V->V\b/.test(stdout) &&
            /\s+tonemap\s+V->V\b/.test(stdout),
        );
      },
    );
  }));
}
