// Regression tests for the media HTTP server: URL routing, Range serving, the
// path-confinement guards, and the ffmpeg remux path (status-code behaviour only).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { FFMPEG } from "../ffmpeg-paths.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { openDb, nowUnix, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";
import { startServer } from "../server.js";
import type { Core } from "../index.js";

const WS = "abc123";
const TOKEN = "test-token";
let base: string;
let server: Server;
let db: DB;
let root: string;
let dataDir: string;
let outside: string;

let mediaId: number;
let thumbId: number;
let badThumbId: number;
let outsideMediaId: number;
let symlinkMediaId: number;
let remuxId: number;
let brokenRemuxId: number;
let fifoSrc: string;

function insert(
  rel: string,
  absPath: string,
  thumbPath: string | null,
  thumbStatus: string,
): number {
  const info = db
    .prepare(
      `INSERT INTO files (root_id, rel_path, abs_path, kind, ext, thumb_path, thumb_status, created_at)
       VALUES ((SELECT id FROM scan_roots LIMIT 1), ?, ?, 'video', 'mp4', ?, ?, ?)`,
    )
    .run(rel, absPath, thumbPath, thumbStatus, nowUnix());
  return Number(info.lastInsertRowid);
}

function authHeader(): Record<string, string> {
  return { "X-Api-Token": TOKEN };
}

function authHeaders(): RequestInit {
  return { headers: authHeader() };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-srv-root-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-srv-data-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-srv-out-"));
  fs.mkdirSync(path.join(dataDir, "thumbs"), { recursive: true });

  const mediaFile = path.join(root, "a.mp4");
  fs.writeFileSync(mediaFile, "0123456789");
  const thumbFile = path.join(dataDir, "thumbs", "a.webp");
  fs.writeFileSync(thumbFile, "THUMBDATA");
  const outsideThumb = path.join(outside, "evil.webp");
  fs.writeFileSync(outsideThumb, "EVIL");
  const outsideMedia = path.join(outside, "evil.mp4");
  fs.writeFileSync(outsideMedia, "EVIL");
  const symlinkMedia = path.join(root, "symlink.mp4");
  fs.symlinkSync(outsideMedia, symlinkMedia);

  // A real (tiny) Matroska file so the remux path actually transcodes to fMP4,
  // and a bogus one so the immediate-failure branch (0-byte output ⇒ 500) is
  // exercised. mkv is in REMUX_CONTAINERS, so both take the ffmpeg remux route.
  const remuxFile = path.join(root, "real.mkv");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=32x32:rate=10:duration=0.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    remuxFile,
  ]);
  const brokenFile = path.join(root, "broken.mkv");
  fs.writeFileSync(brokenFile, "NOT A REAL MKV");

  // A longer mkv used as the byte source for the FIFO late-join test below
  // (more frames/keyframes so ffmpeg emits the init segment well before EOF).
  if (process.platform !== "win32") {
    fifoSrc = path.join(root, "fifo-src.mkv");
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x64:rate=30:duration=2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-g",
      "10",
      "-pix_fmt",
      "yuv420p",
      fifoSrc,
    ]);
  }

  db = openDb(":memory:");
  upsertScanRoot(db, root, "h");
  mediaId = insert("a.mp4", mediaFile, thumbFile, "done");
  thumbId = mediaId;
  badThumbId = insert("b.mp4", path.join(root, "b.mp4"), outsideThumb, "done");
  outsideMediaId = insert("c.mp4", outsideMedia, null, "pending");
  symlinkMediaId = insert("symlink.mp4", symlinkMedia, null, "pending");
  remuxId = insert("real.mkv", remuxFile, null, "pending");
  brokenRemuxId = insert("broken.mkv", brokenFile, null, "pending");

  const core = { db, dataDir, root } as unknown as Core;
  ({ server } = await startServer((id) => (id === WS ? core : null), TOKEN));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  expect(port).toBeGreaterThan(0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

describe("routing", () => {
  it("rejects requests without the media token header", async () => {
    expect((await fetch(`${base}/ws/${WS}/media/${mediaId}`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/ws/${WS}/media/${mediaId}`, {
          headers: { "X-Api-Token": "wrong-token" },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects malformed URLs with 400", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(400);
    expect((await fetch(`${base}/ws/${WS}/bogus/1`)).status).toBe(400);
  });

  it("returns 404 for an unknown workspace id", async () => {
    expect(
      (await fetch(`${base}/ws/ffffff/media/${mediaId}`, authHeaders())).status,
    ).toBe(404);
  });

  it("returns 404 for a missing file id", async () => {
    expect(
      (await fetch(`${base}/ws/${WS}/media/99999`, authHeaders())).status,
    ).toBe(404);
  });
});

describe("thumb serving", () => {
  it("serves a thumbnail inside the data dir", async () => {
    const res = await fetch(`${base}/ws/${WS}/thumb/${thumbId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("THUMBDATA");
  });

  it("refuses a thumb_path that escapes the data dir (path confinement)", async () => {
    expect(
      (await fetch(`${base}/ws/${WS}/thumb/${badThumbId}`, authHeaders()))
        .status,
    ).toBe(404);
  });

  it("serves thumbnails with Cache-Control and an ETag", async () => {
    const res = await fetch(`${base}/ws/${WS}/thumb/${thumbId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("etag")).toMatch(/^"\d+-\d+"$/);
  });

  it("answers a matching If-None-Match with 304 (incl. weak and list forms)", async () => {
    const first = await fetch(
      `${base}/ws/${WS}/thumb/${thumbId}`,
      authHeaders(),
    );
    const etag = first.headers.get("etag")!;
    await first.arrayBuffer(); // drain

    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const res = await fetch(`${base}/ws/${WS}/thumb/${thumbId}`, {
        headers: { ...authHeader(), "If-None-Match": header },
      });
      expect(res.status, `If-None-Match: ${header}`).toBe(304);
    }

    const miss = await fetch(`${base}/ws/${WS}/thumb/${thumbId}`, {
      headers: { ...authHeader(), "If-None-Match": '"stale-etag"' },
    });
    expect(miss.status).toBe(200);
    expect(await miss.text()).toBe("THUMBDATA");
  });

  it("does not add cache headers to media responses", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("etag")).toBeNull();
    await res.arrayBuffer();
  });
});

describe("media serving and Range", () => {
  it("serves the whole file with Accept-Ranges", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123456789");
  });

  it("honours a Range request with a 206 partial response", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, {
      headers: { ...authHeader(), Range: "bytes=2-5" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  it("clamps an open-ended Range to the tail", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, {
      headers: { ...authHeader(), Range: "bytes=7-" },
    });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("789");
  });

  it("honours a suffix Range request from the tail", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, {
      headers: { ...authHeader(), Range: "bytes=-4" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(await res.text()).toBe("6789");
  });

  it("returns 416 for an unsatisfiable Range request", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${mediaId}`, {
      headers: { ...authHeader(), Range: "bytes=99-100" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("refuses an abs_path outside the scan root with 403 (path confinement)", async () => {
    expect(
      (await fetch(`${base}/ws/${WS}/media/${outsideMediaId}`, authHeaders()))
        .status,
    ).toBe(403);
  });

  it("refuses a symlink under the root that points outside with 403", async () => {
    expect(
      (await fetch(`${base}/ws/${WS}/media/${symlinkMediaId}`, authHeaders()))
        .status,
    ).toBe(403);
  });
});

describe("frame serving (ffmpeg path)", () => {
  async function expectJpeg(res: Response) {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const buf = Buffer.from(await res.arrayBuffer());
    // JPEG SOI marker, so we know real image bytes came back.
    expect(buf.length).toBeGreaterThan(2);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  }

  it("serves a frame with an allowed quality preset", async () => {
    await expectJpeg(
      await fetch(`${base}/ws/${WS}/frame/${remuxId}?t=0&q=high`, authHeaders()),
    );
  });

  it("falls back to the default quality for an unknown ?q value", async () => {
    await expectJpeg(
      await fetch(`${base}/ws/${WS}/frame/${remuxId}?t=0&q=9999`, authHeaders()),
    );
    await expectJpeg(
      await fetch(`${base}/ws/${WS}/frame/${remuxId}`, authHeaders()),
    );
  });
});

describe("media remux (ffmpeg path)", () => {
  it("remuxes an mkv to fragmented MP4 with a 200", async () => {
    const res = await fetch(`${base}/ws/${WS}/media/${remuxId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    const buf = Buffer.from(await res.arrayBuffer());
    // A valid fMP4 stream starts with an `ftyp` box; assert the magic so we know
    // real bytes were streamed (not an empty 200).
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(4, 8).toString("latin1")).toBe("ftyp");
  });

  it("returns 500 when ffmpeg fails immediately (no output) instead of an empty 200", async () => {
    const res = await fetch(
      `${base}/ws/${WS}/media/${brokenRemuxId}`,
      authHeaders(),
    );
    expect(res.status).toBe(500);
  });

  it("deduplicates concurrent remux requests for the same file", async () => {
    const [a, b] = await Promise.all([
      fetch(`${base}/ws/${WS}/media/${remuxId}`, authHeaders()),
      fetch(`${base}/ws/${WS}/media/${remuxId}`, authHeaders()),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    for (const res of [a, b]) {
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(0);
      expect(buf.subarray(4, 8).toString("latin1")).toBe("ftyp");
    }
  });

  // Streamed GET that resolves `first` on the first body chunk and `done` with
  // the full body — fetch() cannot observe mid-stream progress like this.
  function getStreaming(pathname: string) {
    const chunks: Buffer[] = [];
    let resolveFirst!: () => void;
    const first = new Promise<void>((r) => (resolveFirst = r));
    const done = new Promise<{ status: number; body: Buffer }>(
      (resolve, reject) => {
        const req = http.get(
          `${base}${pathname}`,
          { headers: authHeader() },
          (res) => {
            res.on("data", (c: Buffer) => {
              chunks.push(c);
              resolveFirst();
            });
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        req.on("error", reject);
      },
    );
    return { first, done };
  }

  it.skipIf(process.platform === "win32")(
    "replays the fMP4 init segment to a client joining an in-flight session",
    async () => {
      // Feed the mkv through a FIFO so the remux session deterministically
      // stays open while a second client joins mid-stream. Without the history
      // replay the late joiner would never see the ftyp/moov init segment.
      const mkvBytes = fs.readFileSync(fifoSrc);
      const fifoPath = path.join(root, "fifo.mkv");
      execFileSync("mkfifo", [fifoPath]);
      const fifoId = insert("fifo.mkv", fifoPath, null, "pending");

      const writer = fs.createWriteStream(fifoPath);
      const a = getStreaming(`/ws/${WS}/media/${fifoId}`);
      // Everything except the tail: enough for ffmpeg to probe the input and
      // emit the init segment, while EOF (= session end) is still held back.
      writer.write(mkvBytes.subarray(0, mkvBytes.length - 4096));
      await a.first;

      const b = getStreaming(`/ws/${WS}/media/${fifoId}`);
      // The only bytes B can receive here are the replayed history.
      await b.first;

      writer.end(mkvBytes.subarray(mkvBytes.length - 4096));
      const [ra, rb] = await Promise.all([a.done, b.done]);
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
      expect(ra.body.subarray(4, 8).toString("latin1")).toBe("ftyp");
      // The late joiner must end up with the byte-identical stream.
      expect(rb.body.equals(ra.body)).toBe(true);
    },
    15_000,
  );
});
