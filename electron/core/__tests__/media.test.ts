// Regression tests for frame export (media.ts): real ffmpeg extraction into
// PNG/JPEG files, format selection, and failure behaviour on broken input.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../ffmpeg-paths.js";
import {
  coverArtStreamIndex,
  exportFrame,
  extractMeta,
  generateThumb,
} from "../media.js";

let dir: string;
let video: string;
let broken: string;
let audio: string;
let audioWithArt: string;
let audioWithVideoAndArt: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-media-"));
  video = path.join(dir, "src.mp4");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x48:rate=10:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  broken = path.join(dir, "broken.mp4");
  fs.writeFileSync(broken, "NOT A REAL MP4");

  // A plain 1-second tone.
  audio = path.join(dir, "tone.mp3");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libmp3lame",
    audio,
  ]);

  // The same tone with embedded cover art: ffprobe reports a *video* stream for
  // the jacket, so reading the video stream would misattribute the artwork's
  // 64x48 dimensions and mjpeg codec to the track itself.
  audioWithArt = path.join(dir, "tone-art.mp3");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=64x48:duration=1:rate=1",
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "libmp3lame",
    "-c:v",
    "mjpeg",
    "-frames:v",
    "1",
    "-id3v2_version",
    "3",
    "-metadata:s:v",
    "title=Album cover",
    "-metadata:s:v",
    "comment=Cover (front)",
    audioWithArt,
  ]);

  // A file holding BOTH a real (moving) video stream and an attached picture.
  // Mapping "the first video stream" here picks the 96x48 movie rather than the
  // 32x32 jacket, so the cover stream must be selected by its absolute index.
  const avOnly = path.join(dir, "av.m4a");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=96x48:rate=10:duration=1",
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "aac",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    avOnly,
  ]);
  const coverJpg = path.join(dir, "cover.jpg");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=32x32:duration=1:rate=1",
    "-frames:v",
    "1",
    coverJpg,
  ]);
  audioWithVideoAndArt = path.join(dir, "av-art.m4a");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-i",
    avOnly,
    "-i",
    coverJpg,
    "-map",
    "0",
    "-map",
    "1:v",
    "-c",
    "copy",
    "-disposition:v:1",
    "attached_pic",
    audioWithVideoAndArt,
  ]);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("exportFrame", () => {
  it("writes a PNG frame at the requested offset", async () => {
    const dest = path.join(dir, "out.png");
    await expect(exportFrame(video, dest, 0.5, "png")).resolves.toBe(true);
    const buf = fs.readFileSync(dest);
    // PNG magic bytes.
    expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("writes a JPEG frame when format=jpeg", async () => {
    const dest = path.join(dir, "out.jpg");
    await expect(exportFrame(video, dest, 0, "jpeg")).resolves.toBe(true);
    const buf = fs.readFileSync(dest);
    // JPEG SOI marker.
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("keeps the source resolution (no scaling)", async () => {
    const dest = path.join(dir, "size.png");
    await expect(exportFrame(video, dest, 0.2, "png")).resolves.toBe(true);
    const buf = fs.readFileSync(dest);
    // PNG IHDR: width/height are big-endian uint32 at offsets 16/20.
    expect(buf.readUInt32BE(16)).toBe(64);
    expect(buf.readUInt32BE(20)).toBe(48);
  });

  it("refuses non-finite or negative offsets without invoking ffmpeg", async () => {
    const dest = path.join(dir, "invalid-offset.png");
    await expect(exportFrame(video, dest, NaN, "png")).resolves.toBe(false);
    await expect(exportFrame(video, dest, Infinity, "png")).resolves.toBe(
      false,
    );
    await expect(exportFrame(video, dest, -1, "png")).resolves.toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("returns false for a broken input instead of throwing", async () => {
    const dest = path.join(dir, "never.png");
    await expect(exportFrame(broken, dest, 0, "png")).resolves.toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("falls back to the keyframe-only seek for offsets past the end", async () => {
    // The hybrid post-input seek yields zero frames past EOF; the keyframe-only
    // retry (pure pre-input -ss) can still fail for the same reason, so either
    // a valid last-keyframe frame or a clean false is acceptable — but never a throw.
    const dest = path.join(dir, "past-end.png");
    const ok = await exportFrame(video, dest, 999, "png");
    if (ok) {
      const buf = fs.readFileSync(dest);
      expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } else {
      expect(fs.existsSync(dest)).toBe(false);
    }
  });
});

describe("extractMeta", () => {
  it("reads duration from an audio file with no video-only fields", async () => {
    const meta = await extractMeta(audio, "audio");
    expect(meta.duration).toBeGreaterThan(0.5);
    expect(meta.duration).toBeLessThan(2);
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
    expect(meta.fps).toBeNull();
    expect(meta.codec).toBe("mp3");
  });

  it("ignores embedded cover art rather than reporting it as the track's own dimensions", async () => {
    const meta = await extractMeta(audioWithArt, "audio");
    // The regression this guards: reading the video stream would yield 64x48 / mjpeg.
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
    expect(meta.fps).toBeNull();
    expect(meta.codec).toBe("mp3");
    expect(meta.duration).toBeGreaterThan(0.5);
  });

  it("still reads the video stream for video files", async () => {
    const meta = await extractMeta(video, "video");
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(48);
    expect(meta.codec).toBe("h264");
    expect(meta.duration).toBeGreaterThan(0);
  });

  it("returns empty meta for a broken file instead of throwing", async () => {
    const meta = await extractMeta(broken, "video");
    expect(meta).toEqual({
      width: null,
      height: null,
      duration: null,
      codec: null,
      fps: null,
      capturedAt: null,
      raw: null,
    });
  });
});

describe("coverArtStreamIndex", () => {
  it("returns the index of an embedded cover picture", async () => {
    const meta = await extractMeta(audioWithArt, "audio");
    expect(coverArtStreamIndex(meta.raw)).toBe(1);
  });

  it("returns null for audio with no cover", async () => {
    const meta = await extractMeta(audio, "audio");
    expect(coverArtStreamIndex(meta.raw)).toBeNull();
  });

  it("returns null for a real video stream rather than treating it as artwork", async () => {
    // The regression this guards: keying on "has a video stream" instead of the
    // attached_pic disposition would make a mis-tagged file look like it has a cover.
    const meta = await extractMeta(video, "video");
    expect(coverArtStreamIndex(meta.raw)).toBeNull();
  });

  it("skips a real video stream to find the attached picture behind it", async () => {
    // Stream order is audio(0), video(1), cover(2). Returning 1 — "the first
    // video stream" — would make generateThumb encode a frame of the movie.
    const meta = await extractMeta(audioWithVideoAndArt, "audio");
    expect(coverArtStreamIndex(meta.raw)).toBe(2);
  });

  it("returns null for a failed probe (raw is null) instead of throwing", () => {
    expect(coverArtStreamIndex(null)).toBeNull();
    expect(coverArtStreamIndex(undefined)).toBeNull();
    expect(coverArtStreamIndex({})).toBeNull();
  });
});

describe("generateThumb (audio cover art)", () => {
  it("extracts the embedded cover into a webp", async () => {
    const dest = path.join(dir, "cover.webp");
    const meta = await extractMeta(audioWithArt, "audio");
    const idx = coverArtStreamIndex(meta.raw);
    await expect(
      generateThumb(audioWithArt, "audio", dest, undefined, undefined, idx!),
    ).resolves.toBe(true);
    const buf = fs.readFileSync(dest);
    // RIFF....WEBP container magic.
    expect(buf.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  it("encodes the jacket, not a frame of a real video stream in the same file", async () => {
    const dest = path.join(dir, "av-cover.webp");
    const meta = await extractMeta(audioWithVideoAndArt, "audio");
    const idx = coverArtStreamIndex(meta.raw);
    await expect(
      generateThumb(
        audioWithVideoAndArt,
        "audio",
        dest,
        undefined,
        undefined,
        idx!,
      ),
    ).resolves.toBe(true);
    // Lossy webp stores the dimensions as 14-bit LE fields at bytes 26/28. The
    // jacket is 32x32; encoding the movie stream instead would give 96x48.
    const buf = fs.readFileSync(dest);
    expect(buf.readUInt16LE(26) & 0x3fff).toBe(32);
    expect(buf.readUInt16LE(28) & 0x3fff).toBe(32);
  });

  it("returns false without invoking ffmpeg when no cover index is given", async () => {
    const dest = path.join(dir, "no-cover.webp");
    await expect(generateThumb(audio, "audio", dest)).resolves.toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });
});
