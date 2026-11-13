// Local HTTP media server on 127.0.0.1 (Range support).
//
// Policy: Chromium's <video> can play MP4(H.264)/WebM etc. with Range seeking
// (even with non-faststart where moov is at the end, it can read it via a Range request to the tail).
// Directly playable files use Range for full seeking. Containers Chromium
// cannot demux (mkv/avi/wmv/flv/ts) are remuxed on the fly to fragmented MP4 with ffmpeg
// and served. Dolby Digital audio is converted to AAC for the built-in player.
// ProRes uses a compatible H.264 preview instead of stream copy.
// Both streams support time seeking via ?t=<seconds>.
//
// URLs have the form /ws/<workspaceId>/<kind>/<fileId> (kind = thumb|media|frame).
// Requests must include X-Api-Token; the Electron session injects it for in-app media loads.
// Resolving the DB by workspace ID lets it serve correctly without depending on the active switch,
// and the browser cache key is naturally separated by ID as well.
// frame returns a single JPEG frame at ?t=<seconds> (for seek preview).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { directDolbyTracks, isDolbyDigital } from "./dolbyAudio.js";
import type { Core } from "./index.js";
import { mediaFileOf, thumbPathIfDone } from "./tags.js";
import { isInsideRoot } from "./paths.js";
import { FFMPEG } from "./ffmpeg-paths.js";
import { isHeif, renderHeif } from "./heif.js";
import { QueueFullError, Semaphore } from "./concurrency.js";
import { DECODE_FFMPEG_THREADS, videoDecodeSlots } from "./mediaConcurrency.js";
import { scopedLog } from "./logger.js";
import {
  PREVIEW_AUDIO_TRACK_PARAM,
  REMUX_CONTAINERS,
  hasRemuxVideo,
} from "../../shared/playbackTracks.js";
import { readEmbeddedTracks } from "../../shared/embeddedSubtitles.js";
import { probePlaybackMetadata } from "./playbackMetadata.js";

const log = scopedLog("server");

// Cap one-shot FFmpeg requests and periods without output in remux streams.
// This prevents corrupt media from pinning a slot indefinitely.
// SIGKILL ensures the child actually dies if it ignores SIGTERM.
const FFMPEG_REQUEST_TIMEOUT_MS = 60_000;
const FFMPEG_KILL_SIGNAL = "SIGKILL" as const;
// Decoding requests (frame grabs, image transcodes) take a slot from the
// process-wide `videoDecodeSlots` pool shared with the scan pipeline
// (mediaConcurrency.ts). Remux sessions copy the picture and may encode audio.
// They live as long as playback, so they get their own cap: one long
// movie must not pin a decode slot for hours. The number is a count of
// concurrent playback sessions (a single user rarely has more than a couple
// open at once) rather than anything CPU-derived.
const REMUX_MAX_CONCURRENT = 8;
const remuxSlots = new Semaphore(REMUX_MAX_CONCURRENT);
// Playback can stay open for a long time. Keep its decoders separate from the
// thumbnail and scrub pool, and cap concurrent previews and FFmpeg threads.
const proResPreviewSlots = new Semaphore(2);
// Requests queued for a slot are bounded too, so a burst of frame grabs (or
// a renderer gone haywire) cannot pile up sockets and waiters without limit;
// beyond this the request is shed with 503. A client that disconnects while
// queued is dropped from the queue right away.
const MAX_WAITING = 32;

/**
 * Take a slot on behalf of `res`: null (with the response already ended) when
 * the queue is full or the client went away while waiting.
 */
async function acquireForResponse(
  slots: Semaphore,
  res: http.ServerResponse,
): Promise<(() => void) | null> {
  const gone = new AbortController();
  const onClose = () => gone.abort();
  res.on("close", onClose);
  try {
    return await slots.acquire({
      signal: gone.signal,
      maxWaiting: MAX_WAITING,
    });
  } catch (e) {
    if (e instanceof QueueFullError) {
      if (!res.headersSent) res.writeHead(503, { "Retry-After": "1" }).end();
    } else if (!gone.signal.aborted) {
      // Not the client leaving: don't leave the socket dangling.
      log.warn("slot acquire failed:", e);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return null;
  } finally {
    res.off("close", onClose);
  }
}

// Image formats Chromium cannot decode natively are transcoded to JPEG with ffmpeg on the fly.
// (jpg/png/gif/webp/avif/bmp render directly, so they are served as raw files.)
const TRANSCODE_IMAGES = new Set(["heic", "heif", "tiff"]);
const DIRECT_DOLBY_CONTAINERS = new Set(["mp4", "m4v", "mov"]);

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
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    // Opus is effectively always Ogg-contained, and audio/opus is not reliably recognized.
    opus: "audio/ogg",
    wav: "audio/wav",
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
    const server = http.createServer((req, res) => {
      // handle() catches its own errors; nothing to await here.
      void handle(req, res, resolveWorkspace, authToken);
    });
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

async function handle(
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
    // Answer CORS preflight before routing/token checks so OPTIONS gets a
    // proper preflight response (Allow-Methods/Headers) instead of being
    // treated as a media request. Keeps any future non-simple fetch (custom
    // headers/methods) from the renderer working.
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
      // Thumbnails get max-age + ETag (not `immutable` — see the note on
      // THUMB_CACHE_CONTROL) so repeat grid renders hit the browser cache and
      // revalidations come back as cheap 304s.
      await serveFile(req, res, tp, THUMB_CACHE_CONTROL);
      return;
    }

    const file = mediaFileOf(core.db, id);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    const abs = file.absPath;
    if (!isInsideRoot(abs, core.root)) {
      res.writeHead(403).end();
      return;
    }

    if (kind === "frame") {
      // Serve a frame for seek preview (extract a single frame at the ?t=seconds position).
      const t = Number(url.searchParams.get("t") ?? "0");
      const q = parseFrameQuality(url.searchParams.get("q"));
      serveFrame(res, abs, isFinite(t) && t > 0 ? t : 0, q);
      return;
    }

    // kind === "media"
    const startT = url.searchParams.get("t");
    // Repack unsupported containers. ProRes needs a codec conversion even
    // when it lives in a container Chromium can demux, such as MOV.
    const proResPreview = file.kind === "video" && file.codec === "prores";
    const parsed = startT != null ? Number(startT) : NaN;
    const start = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    const extension = ext(abs);
    const remux = proResPreview || REMUX_CONTAINERS.has(extension);
    const directDolby =
      !proResPreview &&
      file.kind === "video" &&
      DIRECT_DOLBY_CONTAINERS.has(extension);
    const requested = url.searchParams.get(PREVIEW_AUDIO_TRACK_PARAM);
    const needsStreams =
      directDolby ||
      (remux &&
        (requested !== null || (!proResPreview && req.method !== "HEAD")));
    let metadata: unknown;
    if (needsStreams) {
      const row = core.db
        .prepare("SELECT meta FROM files WHERE id = ?")
        .get(id) as { meta: string | null } | undefined;
      metadata = await probePlaybackMetadata(abs, row?.meta);
      if (res.destroyed || res.writableEnded) return;
    }

    // Chromium can show the picture while silently dropping default Dolby
    // audio. Preserve the primary video and convert just the default audio.
    const directTrack = directDolby ? directDolbyTracks(metadata) : undefined;
    if (directTrack) {
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "video/mp4" }).end();
        return;
      }
      serveRemux(res, abs, start, "aac", directTrack.audio, directTrack.video);
      return;
    }
    if (remux) {
      const tracks = readEmbeddedTracks(metadata, "audio");
      let audioTrack: number | undefined;
      if (requested !== null) {
        const audio = /^\d+$/.test(requested) ? Number(requested) : -1;
        if (
          !Number.isSafeInteger(audio) ||
          audio < 0 ||
          audio >= tracks.length ||
          (!proResPreview && !hasRemuxVideo(metadata))
        ) {
          res.writeHead(400).end();
          return;
        }
        audioTrack = audio;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "video/mp4" }).end();
        return;
      }
      // Keep the Dolby fallback for FFmpeg's automatic track selection.
      const dolby =
        audioTrack !== undefined
          ? isDolbyDigital(tracks[audioTrack].codec)
          : tracks.some(({ codec }) => isDolbyDigital(codec));
      const mode = proResPreview ? "prores" : dolby ? "aac" : "copy";
      serveRemux(res, abs, start, mode, audioTrack);
      return;
    }
    // Chromium-unsupported image formats (heic/heif/tiff) are transcoded to JPEG.
    if (TRANSCODE_IMAGES.has(extension)) {
      await serveTranscodedImage(res, abs);
      return;
    }
    // Everything else (mp4/mov/webm/images) is served via Range = full seeking.
    await serveFile(req, res, abs);
  } catch (e) {
    if (e instanceof QueueFullError) {
      if (!res.headersSent && !res.destroyed)
        res.writeHead(503, { "Retry-After": "1" }).end();
      return;
    }
    log.error("request failed:", req.method, req.url ?? "", e);
    if (!res.headersSent) res.writeHead(500).end();
  }
}

/**
 * If-None-Match may be a comma-separated list, a repeated header (string[]),
 * `*`, and each entry may carry a weak `W/` prefix — 304 revalidation uses the
 * weak comparison, so strip the prefix before comparing against our ETag.
 */
function etagMatches(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw.split(",").some((entry) => {
    const tag = entry.trim();
    if (tag === "*") return true;
    return (tag.startsWith("W/") ? tag.slice(2) : tag) === etag;
  });
}

// Let the browser cache thumbnails instead of re-requesting on every grid
// render. Not `immutable`: the renderer's `?v=` cache buster is a per-component
// counter (not a persistent version), so a regenerated thumbnail can be
// requested under an old `?v=`. The ETag below lets those revalidations come
// back as a cheap 304 instead of a full body once max-age expires.
const THUMB_CACHE_CONTROL = "public, max-age=3600";

async function serveFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  cacheControl?: string,
) {
  let st: fs.Stats;
  try {
    // Async stat: a synchronous stat on a network FS (SMB) would block the
    // main-process event loop (UI/IPC/serving) for every media request.
    st = await fs.promises.stat(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const size = st.size;
  const ctype = contentType(file);
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
    // Weak content validator from stat (regeneration rewrites the file, so
    // size+mtime changes). Answers conditional requests with 304.
    const etag = `"${size}-${Math.trunc(st.mtimeMs)}"`;
    res.setHeader("ETag", etag);
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.writeHead(304).end();
      return;
    }
  }
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

type RemuxMode = "copy" | "aac" | "prores";

function remuxKey(
  file: string,
  start: number | null,
  mode: RemuxMode,
  audioTrack?: number,
  videoTrack?: number,
): string {
  return `${file}\0${start ?? ""}\0${mode}\0${audioTrack ?? ""}\0${videoTrack ?? ""}`;
}

function spawnFfmpegChild(
  args: string[],
  timeout = FFMPEG_REQUEST_TIMEOUT_MS,
): ChildProcess {
  return spawn(FFMPEG, args, {
    stdio: ["ignore", "pipe", "ignore"],
    timeout,
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
  mode: RemuxMode,
  audioTrack?: number,
  videoTrack?: number,
) {
  const proResPreview = mode === "prores";
  const args = ["-v", "error"];
  if (proResPreview)
    args.push(
      "-threads",
      String(DECODE_FFMPEG_THREADS),
      "-filter_threads",
      "1",
    );
  if (start != null && start > 0) args.push("-ss", start.toFixed(3));
  // Keep FFmpeg's automatic picture selection for remux-only containers.
  // The last matching input discard option keeps just the chosen audio track.
  if (!proResPreview && videoTrack === undefined && audioTrack !== undefined)
    args.push("-discard:a", "all", `-discard:a:${audioTrack}`, "none");
  args.push("-i", file);
  if (proResPreview) {
    args.push(
      "-map",
      "0:v:0",
      "-map",
      `0:a:${audioTrack ?? 0}?`,
      "-write_tmcd",
      "0",
      "-vf",
      "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-threads:v",
      "2",
      "-force_key_frames",
      "expr:gte(t,n_forced*1)",
      "-c:a",
      "aac",
    );
  } else {
    if (videoTrack !== undefined)
      args.push("-map", `0:${videoTrack}`, "-map", `0:a:${audioTrack}`);
    else if (audioTrack !== undefined) args.push("-sn", "-dn");
    args.push("-c", "copy");
    if (mode === "aac") args.push("-c:a", "aac", "-b:a", "384k");
  }
  args.push(
    "-movflags",
    // Delay the header until FFmpeg knows the copied video's keyframe
    // preroll and can put it on the same timeline as re-encoded audio.
    mode === "aac"
      ? "frag_keyframe+delay_moov+default_base_moof"
      : "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  );

  // A remux can legitimately outlive the one-shot FFmpeg deadline.
  const child = spawnFfmpegChild(args, 0);
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
  let lastOutputAt = Date.now();
  // Bound periods without output, excluding pauses caused by the client.
  const watchdog = setInterval(() => {
    if (session.blocked.size > 0) lastOutputAt = Date.now();
    else if (Date.now() - lastOutputAt >= FFMPEG_REQUEST_TIMEOUT_MS)
      child.kill(FFMPEG_KILL_SIGNAL);
  }, 5_000).unref();
  child.stdout!.on("data", (chunk: Buffer) => {
    sawOutput = true;
    lastOutputAt = Date.now();
    broadcastRemuxChunk(key, session, chunk);
  });
  child.on("error", () => {
    finishRemuxClients(session, false);
    endRemuxSession(key, session);
  });
  child.on("close", (code) => {
    clearInterval(watchdog);
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
  void (async () => {
    const releaseSlot = await acquireForResponse(videoDecodeSlots, res);
    if (!releaseSlot) return;

    let child: ChildProcess;
    try {
      child = spawnFfmpeg(args, res);
    } catch (e) {
      // spawn() throws synchronously on bad options; the slot is shared with
      // the scan pipeline, so it must not leak here.
      releaseSlot();
      if (!res.headersSent) res.writeHead(500).end();
      log.warn("ffmpeg spawn failed:", e);
      return;
    }
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

// Frame-preview quality presets. Keys are the only values accepted from the
// ?q= query param (allowlist); anything else falls back to "low".
const FRAME_QUALITY = {
  low: { width: 240, qv: null },
  standard: { width: 480, qv: 4 },
  high: { width: 960, qv: 2 },
} as const;
type FrameQuality = keyof typeof FRAME_QUALITY;

function parseFrameQuality(v: string | null): FrameQuality {
  // Object.hasOwn (not `in`) so prototype members like "toString" don't pass.
  return v !== null && Object.hasOwn(FRAME_QUALITY, v)
    ? (v as FrameQuality)
    : "low";
}

function serveFrame(
  res: http.ServerResponse,
  file: string,
  t: number,
  quality: FrameQuality = "low",
) {
  const { width, qv } = FRAME_QUALITY[quality];
  // Bounded decoder threads: these runs share the decode slots with the scan
  // pipeline, and per-process memory is what those slots are meant to cap.
  const args = ["-v", "error", "-threads", String(DECODE_FFMPEG_THREADS)];
  if (t > 0) args.push("-ss", t.toFixed(3));
  args.push("-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`);
  if (qv !== null) args.push("-q:v", String(qv));
  args.push("-f", "mjpeg", "pipe:1");
  serveBufferedFfmpeg(res, args, "image/jpeg");
}

// Decode a Chromium-unsupported still image (heic/heif/tiff) to JPEG and return it.
async function serveTranscodedImage(res: http.ServerResponse, file: string) {
  if (isHeif(file)) {
    const release = await acquireForResponse(videoDecodeSlots, res);
    if (!release) return;
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.once("close", onClose);
    try {
      if (res.destroyed) return;
      const jpeg = await renderHeif(file, {}, controller.signal);
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=3600",
          "Content-Length": jpeg.length,
        });
        res.end(jpeg);
      }
      return;
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof QueueFullError) throw error;
      // Fall back to FFmpeg for HEIF variants it can decode directly.
    } finally {
      res.off("close", onClose);
      release();
    }
  }
  const args = [
    "-v",
    "error",
    "-threads",
    String(DECODE_FFMPEG_THREADS),
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
  mode: RemuxMode,
  audioTrack?: number,
  videoTrack?: number,
) {
  const key = remuxKey(file, start, mode, audioTrack, videoTrack);
  const existing = remuxInflight.get(key);
  if (existing) {
    attachRemuxClient(key, existing, res);
    return;
  }

  void (async () => {
    const releaseSlot = await acquireForResponse(
      mode === "prores" ? proResPreviewSlots : remuxSlots,
      res,
    );
    if (!releaseSlot) return;

    const again = remuxInflight.get(key);
    if (again) {
      releaseSlot();
      attachRemuxClient(key, again, res);
      return;
    }

    try {
      startRemuxSession(
        key,
        file,
        start,
        res,
        releaseSlot,
        mode,
        audioTrack,
        videoTrack,
      );
    } catch (e) {
      // spawn() can throw synchronously; the slot would otherwise never be
      // released (it only reaches the session on success).
      releaseSlot();
      if (!res.headersSent) res.writeHead(500).end();
      log.warn("ffmpeg remux spawn failed:", e);
    }
  })();
}
