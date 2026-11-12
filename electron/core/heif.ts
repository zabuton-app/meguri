import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { Semaphore } from "./concurrency.js";
import { FFMPEG, unpackedPath } from "./ffmpeg-paths.js";
import { DECODE_FFMPEG_THREADS } from "./mediaConcurrency.js";

type DecodedImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

// Full-resolution RGBA and the WebAssembly heap can coexist during a decode.
// Share one slot between scan and preview work to bound that memory cost.
const heifSlots = new Semaphore(1);
const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function isHeif(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

async function decode(
  file: string,
  signal: AbortSignal,
): Promise<DecodedImage> {
  signal.throwIfAborted();
  // The source and built main directory are both two levels below the app root.
  const workerFile = unpackedPath(
    fileURLToPath(
      new URL("../../electron/core/heifWorker.cjs", import.meta.url),
    ),
  );
  const worker = new Worker(workerFile, { workerData: file });
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<DecodedImage>((resolve, reject) => {
      onAbort = () =>
        reject(new Error("HEIF decoding cancelled", { cause: signal.reason }));
      signal.addEventListener("abort", onAbort, { once: true });
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("HEIF worker exited")));
      worker.once("message", (result: DecodedImage | { error: string }) => {
        if ("error" in result) reject(new Error(result.error));
        else resolve(result);
      });
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    await worker.terminate();
  }
}

export async function renderHeif(
  file: string,
  options: { thumbnailWidth?: number },
  signal?: AbortSignal,
): Promise<Buffer> {
  const release = await heifSlots.acquire({ signal, maxWaiting: 32 });
  try {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const workSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const { width, height, pixels } = await decode(file, workSignal);
    const args = [
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${width}x${height}`,
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-threads",
      String(DECODE_FFMPEG_THREADS),
    ];
    if (options.thumbnailWidth !== undefined) {
      args.push(
        "-vf",
        `scale='min(${options.thumbnailWidth},iw)':-2`,
        "-c:v",
        "libwebp",
        "-quality",
        "78",
        "-f",
        "webp",
      );
    } else {
      args.push("-c:v", "mjpeg", "-q:v", "2", "-f", "image2pipe");
    }
    args.push("pipe:1");

    const encoding = execFileAsync(FFMPEG, args, {
      encoding: "buffer",
      signal: workSignal,
      killSignal: "SIGKILL",
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
    // The encoder may close stdin first on an early failure.
    encoding.child.stdin?.on("error", () => {});
    encoding.child.stdin?.end(pixels);
    const { stdout } = await encoding;
    if (stdout.length === 0) throw new Error("Empty HEIF preview");
    return stdout;
  } finally {
    release();
  }
}
