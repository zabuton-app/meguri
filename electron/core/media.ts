// Metadata extraction (ffprobe) and thumbnail generation (ffmpeg). Bundled static binaries, no system dependency.
import { execFile } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "./ffmpeg-paths.js";
import log from "./logger.js";
import type { Kind } from "./types.js";

const execFileAsync = promisify(execFile);

export const THUMB_MAX = 480;

export interface ExtractedMeta {
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
  fps: number | null;
  capturedAt: number | null;
  raw: unknown;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  tags?: { creation_time?: string };
}

interface FfprobeFormat {
  duration?: string;
  tags?: { creation_time?: string };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function parseRational(s: string | undefined): number | null {
  if (!s) return null;
  const [n, d] = s.split("/");
  const nn = Number(n);
  const dd = Number(d ?? "1");
  if (!isFinite(nn) || !dd) return null;
  return nn / dd;
}

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(/(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
  return isNaN(t) ? null : Math.floor(t / 1000);
}

/** Get metadata via ffprobe (video, image, and audio). Returns empty meta on failure.
 *
 *  `kind` selects which stream describes the file. For audio it must be the audio
 *  stream: an MP3 carrying embedded cover art also has a video stream, and reading it
 *  would record the jacket's dimensions as the track's own and `mjpeg` as its codec. */
export async function extractMeta(
  file: string,
  kind: Kind,
  signal?: AbortSignal,
): Promise<ExtractedMeta> {
  const empty: ExtractedMeta = {
    width: null,
    height: null,
    duration: null,
    codec: null,
    fps: null,
    capturedAt: null,
    raw: null,
  };
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file,
      ],
      // timeout guards against a corrupt/huge/network-FS file hanging ffprobe and
      // pinning a pool worker slot forever (stalls the whole thumbnail phase). On
      // timeout execFile rejects, and the catch below returns `empty` — same as any
      // other probe failure, so the file is left as-is and retried on the next scan.
      { maxBuffer: 8 * 1024 * 1024, timeout: 60_000, signal },
    );
    const json = JSON.parse(stdout) as FfprobeOutput;
    const streams = json.streams ?? [];
    const wantAudio = kind === "audio";
    const v = streams.find((s) =>
      wantAudio ? s.codec_type === "audio" : s.codec_type === "video",
    );
    const fmt = json.format ?? {};
    return {
      // Audio has no intrinsic dimensions or frame rate. Left null even when the
      // file embeds cover art, whose size describes the artwork and not the track.
      width: wantAudio ? null : (v?.width ?? null),
      height: wantAudio ? null : (v?.height ?? null),
      duration: fmt.duration
        ? Number(fmt.duration)
        : v?.duration
          ? Number(v.duration)
          : null,
      codec: v?.codec_name ?? null,
      fps: wantAudio ? null : parseRational(v?.avg_frame_rate),
      capturedAt:
        parseDate(fmt.tags?.creation_time) ??
        parseDate(v?.tags?.creation_time) ??
        null,
      raw: json,
    };
  } catch {
    return empty;
  }
}

// How many seconds of margin to leave when doing the coarse pre-input seek of the hybrid
// thumbnail seek. The fine post-input seek then decodes that much (worst case) to land on
// the exact target frame. Tuned to comfortably cover typical GOP lengths (1–4 s).
const THUMB_SEEK_MARGIN_SEC = 5;

/** Generate a webp thumbnail. For both images and videos, ffmpeg downscales a representative
 *  frame → webp.
 *
 *  When `offsetSec` is provided for a video, we use a HYBRID seek:
 *    `-ss <offset - MARGIN>` BEFORE `-i` does a cheap keyframe-accurate seek that lands
 *    just before the target, then `-ss <MARGIN>` AFTER `-i` advances frame-by-frame to
 *    the exact target. This keeps us close to the picked frame while avoiding the failure
 *    mode of pure post-input seek on some containers (mkv/avi/wmv/flv/ts), which can
 *    return zero frames when ffmpeg can't establish a usable timeline from the input.
 *    On failure, we fall back once to pre-input-only seek (keyframe-accurate but always
 *    yields a frame) so the user still gets a usable thumbnail. */
export async function generateThumb(
  src: string,
  kind: Kind,
  dest: string,
  signal?: AbortSignal,
  offsetSec?: number,
): Promise<boolean> {
  const useOffset =
    kind === "video" &&
    typeof offsetSec === "number" &&
    Number.isFinite(offsetSec) &&
    offsetSec >= 0;
  if (
    await runFfmpegThumb(
      src,
      kind,
      dest,
      signal,
      useOffset ? offsetSec : undefined,
      false,
    )
  ) {
    return true;
  }
  // Hybrid seek failed (some containers don't survive a post-input -ss). Retry with a
  // pure pre-input seek so the user at least gets the nearest-keyframe frame.
  if (useOffset) {
    return runFfmpegThumb(src, kind, dest, signal, offsetSec, true);
  }
  return false;
}

export type FrameFormat = "png" | "jpeg";

/** Extract one full-resolution frame at `offsetSec` and write it to `dest`.
 *  Uses the same hybrid seek strategy as generateThumb (coarse pre-input -ss +
 *  fine post-input -ss), falling back to a pure pre-input (keyframe-only) seek
 *  for containers where post-input seek yields zero frames. No scaling — the
 *  frame keeps the source resolution. */
export async function exportFrame(
  src: string,
  dest: string,
  offsetSec: number,
  format: FrameFormat,
  signal?: AbortSignal,
): Promise<boolean> {
  // Same offset guard as generateThumb: a non-finite or negative offset would
  // produce a bogus -ss argument, so refuse it instead of passing it to ffmpeg.
  if (!Number.isFinite(offsetSec) || offsetSec < 0) {
    log.warn(`frame export refused: invalid offset (${offsetSec})`);
    return false;
  }
  if (await runFfmpegFrameExport(src, dest, offsetSec, format, false, signal)) {
    return true;
  }
  return runFfmpegFrameExport(src, dest, offsetSec, format, true, signal);
}

async function runFfmpegFrameExport(
  src: string,
  dest: string,
  offsetSec: number,
  format: FrameFormat,
  keyframeOnly: boolean,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const args: string[] = ["-v", "error", "-y"];
  if (keyframeOnly) {
    args.push("-ss", offsetSec.toFixed(3), "-i", src);
  } else {
    const fastSeek = Math.max(0, offsetSec - THUMB_SEEK_MARGIN_SEC);
    const fineSeek = offsetSec - fastSeek;
    args.push("-ss", fastSeek.toFixed(3), "-i", src);
    if (fineSeek > 0.01) args.push("-ss", fineSeek.toFixed(3));
  }
  args.push("-frames:v", "1");
  if (format === "jpeg") args.push("-c:v", "mjpeg", "-q:v", "2");
  else args.push("-c:v", "png");
  args.push(dest);
  try {
    await execFileAsync(FFMPEG, args, { timeout: 60000, signal });
    // ffmpeg exits 0 even when the seek lands past EOF and zero frames are
    // written (no output file, or an empty one) — treat that as a failure and
    // don't leave a 0-byte file behind at the user-chosen destination.
    const st = await fsPromises.stat(dest).catch(() => null);
    if (!st || st.size === 0) {
      if (st) await fsPromises.unlink(dest).catch(() => {});
      log.warn(
        `ffmpeg frame export produced no output (offset=${offsetSec}, format=${format}, mode=${keyframeOnly ? "keyframe" : "hybrid"})`,
      );
      return false;
    }
    return true;
  } catch (err) {
    if (!signal?.aborted) {
      const stderr =
        (err as { stderr?: string }).stderr ??
        (err as Error).message ??
        String(err);
      log.warn(
        `ffmpeg frame export failed (offset=${offsetSec}, format=${format}, mode=${keyframeOnly ? "keyframe" : "hybrid"}): ${stderr}`,
      );
    }
    return false;
  }
}

async function runFfmpegThumb(
  src: string,
  kind: Kind,
  dest: string,
  signal: AbortSignal | undefined,
  offsetSec: number | undefined,
  keyframeOnly: boolean,
): Promise<boolean> {
  const useOffset = typeof offsetSec === "number";
  const vf =
    kind === "video" && !useOffset
      ? `thumbnail,scale='min(${THUMB_MAX},iw)':-2`
      : `scale='min(${THUMB_MAX},iw)':-2`;
  const args: string[] = ["-v", "error", "-y"];
  if (useOffset) {
    if (keyframeOnly) {
      // Pure pre-input seek: fast, always lands on a keyframe (no frame-accuracy retry).
      args.push("-ss", offsetSec.toFixed(3), "-i", src);
    } else {
      // Hybrid: coarse pre-input seek + fine post-input seek for frame accuracy.
      const fastSeek = Math.max(0, offsetSec - THUMB_SEEK_MARGIN_SEC);
      const fineSeek = offsetSec - fastSeek;
      args.push("-ss", fastSeek.toFixed(3), "-i", src);
      if (fineSeek > 0.01) args.push("-ss", fineSeek.toFixed(3));
    }
  } else {
    args.push("-i", src);
  }
  args.push(
    "-vf",
    vf,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "78",
    dest,
  );
  try {
    await execFileAsync(FFMPEG, args, { timeout: 60000, signal });
    return true;
  } catch (err) {
    // Surface ffmpeg's reason so the next failure isn't silent. Aborted runs are expected
    // (the caller cancelled), so don't shout about those.
    if (!signal?.aborted) {
      const stderr =
        (err as { stderr?: string }).stderr ??
        (err as Error).message ??
        String(err);
      log.warn(
        `ffmpeg thumb failed (offset=${offsetSec ?? "auto"}, mode=${keyframeOnly ? "keyframe" : "hybrid"}): ${stderr}`,
      );
    }
    return false;
  }
}
