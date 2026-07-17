// Local HTTP media server on 127.0.0.1 (Range support).
//
// Policy: Chromium's <video> can play MP4(H.264)/WebM etc. with Range seeking
// (even with non-faststart where moov is at the end, it can read it via a Range request to the tail).
// So these are served as raw files via Range to enable full seeking. Only containers Chromium
// cannot demux (mkv/avi/wmv/flv/ts) are remuxed on the fly to fragmented MP4 with ffmpeg
// and served, supporting time seeking via ?t=<seconds> (this path is a stream).
//
// URLs have the form /ws/<workspaceId>/<kind>/<fileId> (kind = thumb|media|frame).
// Requests must include X-Api-Token; the Electron session injects it for in-app media loads.
// Resolving the DB by workspace ID lets it serve correctly without depending on the active switch,
// and the browser cache key is naturally separated by ID as well.
// frame returns a single JPEG frame at ?t=<seconds> (for seek preview).
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Core } from "./index.js";
import { absPathOf, thumbPathIfDone } from "./tags.js";
import { isInsideRoot } from "./paths.js";
import { FFMPEG } from "./ffmpeg-paths.js";
import { Semaphore } from "./concurrency.js";
import { scopedLog } from "./logger.js";

const log = scopedLog("server");

// Only containers Chromium cannot demux are remuxed with ffmpeg and served.
// Everything else (mp4/m4v/mov/webm) is served as a raw file via Range to enable full seeking.
const REMUX_CONTAINERS = new Set(["mkv", "avi", "wmv", "flv", "ts"]);

// Hard cap on ffmpeg streaming/transcoding requests. Without this a corrupt
// media file can hang ffmpeg and pin a request slot indefinitely. 60s matches
// the extractor side in media.ts and gives long-range seeks enough headroom.
// SIGKILL ensures the child actually dies if it ignores SIGTERM.
const FFMPEG_REQUEST_TIMEOUT_MS = 60_000;
const FFMPEG_KILL_SIGNAL = "SIGKILL" as const;
// Cap concurrent ffmpeg child processes so parallel remux/frame requests cannot
// spawn unbounded workers and exhaust CPU / memory on the local host. Scales
// with the machine (same cpus-1 convention as the scan pool in jobs.ts), with
// a floor of 2 so low-core hosts can still overlap a remux and a frame grab.
const FFMPEG_MAX_CONCURRENT = Math.max(2, os.cpus().length - 1);
const ffmpegSem = new Semaphore(FFMPEG_MAX_CONCURRENT);

// Image formats Chromium cannot decode natively are transcoded to JPEG with ffmpeg on the fly.
// (jpg/png/gif/webp/avif/bmp render directly, so they are served as raw files.)
const TRANSCODE_IMAGES = new Set(["heic", "heif", "tiff"]);

function ext(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}

function contentType(p: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    ts: "video/mp2t",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    avif: "image/avif",
  };
  return map[ext(p)] ?? "application/octet-stream";
}

type ParsedRange = [number, number] | "invalid" | null;

function parseRange(header: string | undefined, len: number): ParsedRange {
  if (!header || len === 0) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return "invalid";
  if (!m[1] && !m[2]) return "invalid";

  let start: number;
  let end: number;
  if (!m[1]) {
    // Suffix range: bytes=-500 means the final 500 bytes.
    const suffixLen = parseInt(m[2], 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return "invalid";
    start = Math.max(0, len - suffixLen);
    end = len - 1;
  } else {
    start = parseInt(m[1], 10);
    // Open-ended goes to the tail (memory-safe since createReadStream streams it).
    end = m[2] ? parseInt(m[2], 10) : len - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  end = Math.min(end, len - 1);
  if (start > end || start > len - 1) return "invalid";
  return [start, end];
}

/**
 * Start the media server. Takes a function that resolves a Core from a workspace ID.
 * Returns the bound port and the underlying server (the latter lets callers/tests close it).
 */
export function startServer(
  resolveWorkspace: (id: string) => Core | null,
  authToken: string,
): Promise<{ port: number; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) =>
      handle(req, res, resolveWorkspace, authToken),
    );
    server.on("error", () => resolve({ port: 0, server }));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : 0,
        server,
      });
    });
  });
}

const AUTH_HEADER = "x-api-token";

// URLs have the form /ws/<workspaceId>/<kind>/<fileId>.
const ROUTE = /^\/ws\/([0-9a-f]+)\/(thumb|media|frame)\/(\d+)$/;

function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  resolveWorkspace: (id: string) => Core | null,
  authToken: string,
) {
  try {
    // The renderer origin (localhost:5173 in dev, file:// in prod) differs from
    // this server's 127.0.0.1 origin, so fetch()/canvas need CORS to read media
    // bytes (e.g. copy-image-to-clipboard). Safe to allow broadly: auth is the
    // x-api-token header, injected by the app's webRequest layer — cross-origin
    // pages in external browsers never have it and get 401.
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Answer CORS preflight before the token check: preflight requests never
    // carry the injected auth header, so they would otherwise 401 and block
    // any future non-simple fetch (custom headers/methods) from the renderer.
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": AUTH_HEADER,
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "", "http://127.0.0.1");
    const m = url.pathname.match(ROUTE);
    if (!m) {
      res.writeHead(400).end();
      return;
    }
    const header = req.headers[AUTH_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (token !== authToken) {
      res.writeHead(401).end();
      return;
    }
    const [, wsId, kind, idStr] = m;
    const core = resolveWorkspace(wsId);
    if (!core) {
      res.writeHead(404).end();
      return;
    }
    const id = Number(idStr);

    if (kind === "thumb") {
      const tp = thumbPathIfDone(core.db, id);
      if (!tp || !isInsideRoot(tp, core.dataDir)) {
        res.writeHead(404).end();
        return;
      }
      serveFile(req, res, tp);
      return;
    }

    const abs = absPathOf(core.db, id);
    if (!abs) {
      res.writeHead(404).end();
      return;
    }
    if (!isInsideRoot(abs, core.root)) {
      res.writeHead(403).end();
      return;
    }

    if (kind === "frame") {
      // Serve a frame for seek preview (extract a single frame at the ?t=seconds position).
      const t = Number(url.searchParams.get("t") ?? "0");
      serveFrame(res, abs, isFinite(t) && t > 0 ? t : 0);
      return;
    }

    // kind === "media"
    const startT = url.searchParams.get("t");
    // Only Chromium-unsupported containers are served via remux (time seek via ?t).
    if (REMUX_CONTAINERS.has(ext(abs))) {
      const parsed = startT != null ? Number(startT) : NaN;
      const start = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      serveRemux(res, abs, start);
      return;
    }
    // Chromium-unsupported image formats (heic/heif/tiff) are transcoded to JPEG.
    if (TRANSCODE_IMAGES.has(ext(abs))) {
      serveTranscodedImage(res, abs);
      return;
    }
    // Everything else (mp4/mov/webm/images) is served via Range = full seeking.
    serveFile(req, res, abs);
  } catch (e) {
    log.error("request failed:", req.method, req.url ?? "", e);
    if (!res.headersSent) res.writeHead(500).end();
  }
}

function serveFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
) {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const ctype = contentType(file);
  const range = parseRange(req.headers["range"], size);
  if (range === "invalid") {
    res
      .writeHead(416, {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      })
      .end();
    return;
  }
  if (range) {
    const [start, end] = range;
    res.writeHead(206, {
      "Content-Type": ctype,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
    const stream = fs.createReadStream(file, { start, end });
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.end());
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Type": ctype,
      "Accept-Ranges": "bytes",
      "Content-Length": size,
    });
    const stream = fs.createReadStream(file);
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.end());
    stream.pipe(res);
  }
}

// Quickly extract a single frame at the given seconds using input seek (-ss before -i) and return it as JPEG.

// A late joiner must receive the stream from its first byte: the fMP4 init
// segment (ftyp+empty_moov) is emitted exactly once at the start, so attaching
// mid-stream would hand the client an unplayable tail. Each session therefore
// keeps the bytes broadcast so far and replays them on attach. Once the kept
// history exceeds this cap the session stops admitting new clients (it is
// removed from the in-flight map) and later requests spawn their own ffmpeg.
const REMUX_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

type RemuxSession = {
  child: ChildProcess;
  clients: Set<http.ServerResponse>;
  releaseSlot: () => void;
  ended: boolean;
  // Bytes broadcast so far, replayed to late joiners while `joinable`.
  history: Buffer[];
  historyBytes: number;
  joinable: boolean;
  // Clients whose socket buffer is full; ffmpeg stdout stays paused until all drain.
  blocked: Set<http.ServerResponse>;
};

const remuxInflight = new Map<string, RemuxSession>();

function remuxKey(file: string, start: number | null): string {
  return `${file}\0${start ?? ""}`;
}

function spawnFfmpegChild(args: string[]): ChildProcess {
  return spawn(FFMPEG, args, {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: FFMPEG_REQUEST_TIMEOUT_MS,
    killSignal: FFMPEG_KILL_SIGNAL,
  });
}

/**
 * Spawn ffmpeg with the standard hardened settings used by all serve* helpers below:
 * stdout piped, stdin/stderr ignored, hard timeout (so a bad input can't pin a request slot),
 * and SIGKILL on the response closing early (browser disconnect, etc).
 * Callers must hold an ffmpeg semaphore slot until the child exits.
 */
function spawnFfmpeg(args: string[], res: http.ServerResponse) {
  const child = spawnFfmpegChild(args);
  res.on("close", () => child.kill("SIGKILL"));
  return child;
}

function endRemuxSession(key: string, session: RemuxSession) {
  if (session.ended) return;
  session.ended = true;
  // A non-joinable session was already evicted and the key may now belong to a
  // newer session for the same file — only delete our own map entry.
  if (remuxInflight.get(key) === session) remuxInflight.delete(key);
  session.releaseSlot();
}

function detachRemuxClient(
  key: string,
  session: RemuxSession,
  res: http.ServerResponse,
) {
  session.clients.delete(res);
  session.blocked.delete(res);
  if (session.clients.size === 0) {
    session.child.kill("SIGKILL");
    endRemuxSession(key, session);
  } else {
    resumeIfDrained(session);
  }
}

function attachRemuxClient(
  key: string,
  session: RemuxSession,
  res: http.ServerResponse,
) {
  session.clients.add(res);
  res.on("close", () => detachRemuxClient(key, session, res));
  // Replay everything broadcast before this client joined (incl. the fMP4
  // init segment, which ffmpeg only emits once per stream).
  for (const chunk of session.history) writeRemuxChunk(session, res, chunk);
}

function resumeIfDrained(session: RemuxSession) {
  if (session.blocked.size === 0 && !session.ended) {
    session.child.stdout?.resume();
  }
}

// Write one chunk to one client, honouring socket backpressure: when a
// client's buffer is full, pause ffmpeg stdout until every blocked client has
// drained, so a stalled reader cannot pile the whole remuxed file into memory.
function writeRemuxChunk(
  session: RemuxSession,
  client: http.ServerResponse,
  chunk: Buffer,
) {
  if (client.writableEnded) return;
  if (!client.headersSent) {
    client.writeHead(200, { "Content-Type": "video/mp4" });
  }
  if (!client.write(chunk)) {
    if (!session.blocked.has(client)) {
      session.blocked.add(client);
      client.once("drain", () => {
        session.blocked.delete(client);
        resumeIfDrained(session);
      });
    }
    session.child.stdout?.pause();
  }
}

function broadcastRemuxChunk(
  key: string,
  session: RemuxSession,
  chunk: Buffer,
) {
  if (session.joinable) {
    session.history.push(chunk);
    session.historyBytes += chunk.length;
    if (session.historyBytes > REMUX_HISTORY_MAX_BYTES) {
      // Too much to replay: stop admitting late joiners and free the buffer.
      session.joinable = false;
      session.history = [];
      session.historyBytes = 0;
      if (remuxInflight.get(key) === session) remuxInflight.delete(key);
    }
  }
  for (const client of session.clients) writeRemuxChunk(session, client, chunk);
}

function finishRemuxClients(session: RemuxSession, ok: boolean) {
  for (const client of session.clients) {
    if (client.writableEnded) continue;
    if (!client.headersSent) client.writeHead(ok ? 200 : 500);
    client.end();
  }
}

function startRemuxSession(
  key: string,
  file: string,
  start: number | null,
  res: http.ServerResponse,
  releaseSlot: () => void,
) {
  const args = ["-v", "error"];
  if (start != null && start > 0) args.push("-ss", start.toFixed(3));
  args.push(
    "-i",
    file,
    "-c",
    "copy",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  );

  const child = spawnFfmpegChild(args);
  const session: RemuxSession = {
    child,
    clients: new Set([res]),
    releaseSlot,
    ended: false,
    history: [],
    historyBytes: 0,
    joinable: true,
    blocked: new Set(),
  };
  remuxInflight.set(key, session);
  res.on("close", () => detachRemuxClient(key, session, res));

  let sawOutput = false;
  child.stdout!.on("data", (chunk: Buffer) => {
    sawOutput = true;
    broadcastRemuxChunk(key, session, chunk);
  });
  child.on("error", () => {
    finishRemuxClients(session, false);
    endRemuxSession(key, session);
  });
  child.on("close", (code) => {
    finishRemuxClients(session, code === 0 && sawOutput);
    endRemuxSession(key, session);
  });
}

/**
 * Run ffmpeg with `args` and return the entire stdout as the response body once it exits.
 * Buffered (not streamed) so a decode failure yields 500 rather than an empty 200
 * (broken image). Use for single-frame outputs (thumbs, transcoded stills).
 */
function serveBufferedFfmpeg(
  res: http.ServerResponse,
  args: string[],
  contentType: string,
) {
  let cancelled = false;
  res.on("close", () => {
    cancelled = true;
  });

  void (async () => {
    const releaseSlot = await ffmpegSem.acquire();
    if (cancelled) {
      releaseSlot();
      return;
    }

    const child = spawnFfmpeg(args, res);
    const chunks: Buffer[] = [];
    child.stdout!.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", () => {
      releaseSlot();
      if (!res.headersSent) res.writeHead(500).end();
    });
    child.on("close", (code) => {
      releaseSlot();
      if (res.writableEnded) return;
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "max-age=3600",
          "Content-Length": buf.length,
        });
        res.end(buf);
      } else {
        res.writeHead(500).end();
      }
    });
  })();
}

function serveFrame(res: http.ServerResponse, file: string, t: number) {
  const args = ["-v", "error"];
  if (t > 0) args.push("-ss", t.toFixed(3));
  args.push(
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    "scale=240:-2",
    "-f",
    "mjpeg",
    "pipe:1",
  );
  serveBufferedFfmpeg(res, args, "image/jpeg");
}

// Decode a Chromium-unsupported still image (heic/heif/tiff) to JPEG and return it.
function serveTranscodedImage(res: http.ServerResponse, file: string) {
  const args = [
    "-v",
    "error",
    "-i",
    file,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-f",
    "mjpeg",
    "pipe:1",
  ];
  serveBufferedFfmpeg(res, args, "image/jpeg");
}

function serveRemux(
  res: http.ServerResponse,
  file: string,
  start: number | null,
) {
  const key = remuxKey(file, start);
  const existing = remuxInflight.get(key);
  if (existing) {
    attachRemuxClient(key, existing, res);
    return;
  }

  let cancelled = false;
  res.on("close", () => {
    cancelled = true;
  });

  void (async () => {
    const releaseSlot = await ffmpegSem.acquire();
    if (cancelled) {
      releaseSlot();
      return;
    }

    const again = remuxInflight.get(key);
    if (again) {
      releaseSlot();
      attachRemuxClient(key, again, res);
      return;
    }

    startRemuxSession(key, file, start, res, releaseSlot);
  })();
}
