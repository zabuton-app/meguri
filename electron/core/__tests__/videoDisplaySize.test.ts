// Correction of rotated videos recorded with their stored (pre-rotation) size,
// read back from the raw ffprobe output kept in files.meta.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { storedVideoDisplaySize } from "../media.js";
import { getSetting } from "../queries.js";
import {
  VIDEO_DISPLAY_SIZE_VERSION,
  VIDEO_DISPLAY_SIZE_VERSION_KEY,
  fixVideoDisplaySizes,
  needsVideoDisplaySizeFix,
} from "../videoDisplaySize.js";
import { insertFile, newDb } from "./helpers.js";

/** ffprobe -show_streams output for one video stream, as files.meta stores it. */
function probe(
  width: number,
  height: number,
  rotation?: { matrix?: number; tag?: string },
): unknown {
  return {
    streams: [
      { index: 0, codec_type: "audio", codec_name: "aac" },
      {
        index: 1,
        codec_type: "video",
        codec_name: "h264",
        width,
        height,
        ...(rotation?.tag != null ? { tags: { rotate: rotation.tag } } : {}),
        ...(rotation?.matrix != null
          ? {
              side_data_list: [
                {
                  side_data_type: "Display Matrix",
                  rotation: rotation.matrix,
                },
              ],
            }
          : {}),
      },
    ],
    format: {},
  };
}

describe("storedVideoDisplaySize", () => {
  it("swaps the size for a quarter turn either way", () => {
    for (const matrix of [90, -90, 270, -270]) {
      expect(storedVideoDisplaySize(probe(1920, 1080, { matrix }))).toEqual({
        width: 1080,
        height: 1920,
      });
    }
  });

  it("keeps the size for a half turn or none", () => {
    expect(storedVideoDisplaySize(probe(1920, 1080, { matrix: 180 }))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(storedVideoDisplaySize(probe(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("treats a rotation the same either way round", () => {
    for (const matrix of [135, -135]) {
      expect(storedVideoDisplaySize(probe(1920, 1080, { matrix }))).toEqual({
        width: 1920,
        height: 1080,
      });
    }
  });

  it("reads the rotate tag of older ffprobe output", () => {
    expect(storedVideoDisplaySize(probe(1920, 1080, { tag: "90" }))).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("returns null for output with no sized video stream", () => {
    expect(storedVideoDisplaySize(null)).toBeNull();
    expect(storedVideoDisplaySize({ streams: [] })).toBeNull();
    expect(
      storedVideoDisplaySize({
        streams: [{ codec_type: "video", width: 0, height: 0 }],
      }),
    ).toBeNull();
  });
});

describe("fixVideoDisplaySizes", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  function seed(
    relPath: string,
    width: number,
    height: number,
    meta: unknown,
    kind: "video" | "image" = "video",
  ): number {
    const id = insertFile(db, rootId, { relPath, kind, width, height });
    db.prepare("UPDATE files SET meta = ? WHERE id = ?").run(
      typeof meta === "string" ? meta : JSON.stringify(meta),
      id,
    );
    return id;
  }

  function sizeOf(id: number): { width: number; height: number } {
    return db
      .prepare("SELECT width, height FROM files WHERE id = ?")
      .get(id) as { width: number; height: number };
  }

  it("swaps a rotated video recorded at its stored size", async () => {
    const id = seed(
      "portrait.mp4",
      1920,
      1080,
      probe(1920, 1080, { matrix: -90 }),
    );
    expect(needsVideoDisplaySizeFix(db)).toBe(true);
    expect(await fixVideoDisplaySizes(db)).toBe(1);
    expect(sizeOf(id)).toEqual({ width: 1080, height: 1920 });
    expect(getSetting(db, VIDEO_DISPLAY_SIZE_VERSION_KEY)).toBe(
      String(VIDEO_DISPLAY_SIZE_VERSION),
    );
    expect(needsVideoDisplaySizeFix(db)).toBe(false);
  });

  it("is a no-op on a second run", async () => {
    const id = seed(
      "portrait.mp4",
      1920,
      1080,
      probe(1920, 1080, { matrix: 90 }),
    );
    await fixVideoDisplaySizes(db);
    expect(await fixVideoDisplaySizes(db)).toBe(0);
    expect(sizeOf(id)).toEqual({ width: 1080, height: 1920 });
  });

  it("leaves unrotated, half-turned, already-correct and non-video rows alone", async () => {
    const plain = seed("plain.mp4", 1920, 1080, probe(1920, 1080));
    const upsideDown = seed(
      "flip.mp4",
      1920,
      1080,
      probe(1920, 1080, { matrix: 180 }),
    );
    const fixed = seed(
      "fixed.mp4",
      1080,
      1920,
      probe(1920, 1080, { matrix: -90 }),
    );
    const image = seed(
      "photo.jpg",
      1920,
      1080,
      probe(1920, 1080, { matrix: 90 }),
      "image",
    );
    const unreadable = seed("broken.mp4", 1920, 1080, "{not json");
    expect(await fixVideoDisplaySizes(db)).toBe(0);
    expect(sizeOf(plain)).toEqual({ width: 1920, height: 1080 });
    expect(sizeOf(upsideDown)).toEqual({ width: 1920, height: 1080 });
    expect(sizeOf(fixed)).toEqual({ width: 1080, height: 1920 });
    expect(sizeOf(image)).toEqual({ width: 1920, height: 1080 });
    expect(sizeOf(unreadable)).toEqual({ width: 1920, height: 1080 });
  });

  it("does not record the version when aborted", async () => {
    const id = seed(
      "portrait.mp4",
      1920,
      1080,
      probe(1920, 1080, { matrix: 90 }),
    );
    const ac = new AbortController();
    ac.abort();
    await fixVideoDisplaySizes(db, ac.signal);
    expect(sizeOf(id)).toEqual({ width: 1920, height: 1080 });
    expect(needsVideoDisplaySizeFix(db)).toBe(true);
  });

  it("keeps the version unrecorded when aborted between chunks", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 600; i++) {
      ids.push(
        seed(`bulk/${i}.mp4`, 1920, 1080, probe(1920, 1080, { matrix: 90 })),
      );
    }
    const ac = new AbortController();
    // The first chunk is written before the pass first yields; the abort lands
    // in that yield.
    const run = fixVideoDisplaySizes(db, ac.signal);
    ac.abort();
    expect(await run).toBe(512);
    expect(sizeOf(ids[0])).toEqual({ width: 1080, height: 1920 });
    expect(sizeOf(ids[599])).toEqual({ width: 1920, height: 1080 });
    expect(needsVideoDisplaySizeFix(db)).toBe(true);
  });

  it("covers a library larger than one chunk", async () => {
    // The pass writes a transaction per 512-row page; a cursor left open across
    // that write would throw, which a handful of rows never reaches.
    const ids: number[] = [];
    for (let i = 0; i < 600; i++) {
      ids.push(
        seed(`bulk/${i}.mp4`, 1920, 1080, probe(1920, 1080, { matrix: 90 })),
      );
    }
    expect(await fixVideoDisplaySizes(db)).toBe(600);
    expect(sizeOf(ids[599])).toEqual({ width: 1080, height: 1920 });
  });
});
