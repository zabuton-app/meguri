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
