// Process-wide media concurrency policy: how many ffmpeg decoders may run at
// once (shared by the scan pipeline in jobs.ts and the media server in
// server.ts, so scanning and playback cannot stack up beyond it together),
// and how wide the scan pools are. ffmpeg already decodes multi-threaded, so
// more processes mostly add memory pressure rather than throughput: measured
// with the bundled ffmpeg, a 4K thumbnail at 5 parallel runs as fast as at 31,
// while an uncapped `cpus - 1` peaked at tens of GB on a many-core host and
// could take the renderer down with it.
import os from "node:os";
import { Semaphore } from "./concurrency.js";

const CPUS = os.cpus().length;

/** Measured (scale-before-thumbnail, bounded threads): a 4K thumbnail or
 *  frame grab peaks at roughly 250 MB, so 6 slots stay near 1.5 GB together.
 *  Floor of 2 so low-core hosts can still overlap a thumbnail and a frame
 *  grab. */
export const VIDEO_DECODE_MAX_PARALLEL = Math.max(2, Math.min(6, CPUS - 1));

/** Slots for ffmpeg runs that decode expensive input (video thumbnails and
 *  frame grabs, large-image thumbnails and transcodes). Single FIFO pool
 *  without priorities; remuxing (`-c copy`, no decode) is deliberately not
 *  counted here. */
export const videoDecodeSlots = new Semaphore(VIDEO_DECODE_MAX_PARALLEL);

/** Run `fn` while holding one decode slot. An abort while still queued
 *  rejects with the signal's reason without ever taking a slot. */
export async function withVideoDecodeSlot<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await videoDecodeSlots.acquire({ signal });
  try {
    return await fn();
  } finally {
    release();
  }
}

/** How many decode slots all running scans together may hold. Leaves one
 *  free on small hosts and two on larger ones, so interactive requests (a
 *  scene strip of a dozen frame grabs, a seek preview) are not serialised
 *  behind a backlog of thumbnails; measured, a scan loses almost nothing
 *  from one slot fewer. Enforced by `scanDecodeSlots`, which is process-wide
 *  because the "All" view scans every workspace at once; a scan acquires it
 *  before (never after) a decode slot, and the server takes decode slots
 *  only, so the two can't deadlock. */
export const SCAN_DECODE_MAX_PARALLEL = Math.max(
  1,
  VIDEO_DECODE_MAX_PARALLEL - (VIDEO_DECODE_MAX_PARALLEL <= 3 ? 1 : 2),
);
export const scanDecodeSlots = new Semaphore(SCAN_DECODE_MAX_PARALLEL);

/** Run `fn` while holding a scan share and a decode slot (in that order). */
export async function withScanDecodeSlot<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await scanDecodeSlots.acquire({ signal });
  try {
    return await withVideoDecodeSlot(fn, signal);
  } finally {
    release();
  }
}

/** Width of each scan pool (images and videos run in separate pools so a run
 *  of videos never blocks the image side). This bounds the cheap, I/O-ish
 *  work per file — ffprobe, small-image thumbnails — which is what benefits
 *  from parallelism on a slow share; the expensive decodes inside are bounded
 *  by the slots above regardless of pool width. */
export const SCAN_POOL_WIDTH = Math.max(2, Math.min(8, CPUS - 1));

/** Images at or above this many pixels take a decode slot for their
 *  thumbnail like a video would: measured, a 48-megapixel TIFF peaks at
 *  ~360 MB and a 100-megapixel one at ~720 MB, versus tens of MB for camera
 *  JPEGs, which run at pool width without a slot. */
export const LARGE_IMAGE_PIXELS = 24_000_000;

/** Decoder threads per single-frame ffmpeg run (thumbnails and frame grabs,
 *  video and image alike). A single-frame grab gains little from ffmpeg's
 *  default (all cores), while every extra frame thread holds another decoded
 *  frame in memory. Scaled so the parallel decoders together roughly fill the
 *  machine, capped to keep per-process memory bounded. */
export const DECODE_FFMPEG_THREADS = Math.max(
  2,
  Math.min(4, Math.floor(CPUS / VIDEO_DECODE_MAX_PARALLEL)),
);
