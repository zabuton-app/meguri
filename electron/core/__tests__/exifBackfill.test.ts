// The pass that reads EXIF for photos scanned before it was supported, or
// whose read failed (#701).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { backfillExif } from "../exifBackfill.js";
import { fileTags } from "../tags.js";
import { insertFile, newDb } from "./helpers.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/exif/${name}`, import.meta.url));

const TAKEN = Date.UTC(2019, 6, 21, 5, 35, 0) / 1000;

describe("backfillExif", () => {
  let db: DB;
  let rootId: number;
  let root: string;

  beforeEach(() => {
    ({ db, rootId } = newDb());
    root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-exif-backfill-"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A photo row (exif NULL, as before #701), its file copied from a fixture. */
  function photo(relPath: string, from: string | null, capturedAt?: number) {
    if (from) fs.copyFileSync(fixture(from), path.join(root, relPath));
    return insertFile(db, rootId, {
      relPath,
      root,
      kind: "image",
      width: 16,
      height: 16,
      capturedAt: capturedAt ?? null,
    });
  }

  const rowOf = (id: number) =>
    db.prepare("SELECT exif, captured_at FROM files WHERE id = ?").get(id) as {
      exif: string | null;
      captured_at: number | null;
    };

  it("reads each photo's EXIF, capture time and camera tag", async () => {
    const dated = photo("a.jpg", "dated-offset.jpg");
    const plain = photo("b.png", "no-exif.png");

    expect(await backfillExif(db, {})).toBe(2);

    expect(rowOf(dated).captured_at).toBe(TAKEN);
    expect(JSON.parse(rowOf(dated).exif!)).toMatchObject({
      model: "Canon EOS R5",
    });
    expect(
      fileTags(db, dated)
        .filter((t) => t.namespace === "camera")
        .map((t) => t.name),
    ).toEqual(["Canon EOS R5"]);
    expect(rowOf(plain)).toEqual({ exif: "{}", captured_at: null });
  });

  it("replaces a capture time that did not come from EXIF", async () => {
    const id = photo("a.jpg", "dated-offset.jpg", 1);
    await backfillExif(db, {});
    expect(rowOf(id).captured_at).toBe(TAKEN);
  });

  it("does not read a photo again once read", async () => {
    const id = photo("a.jpg", "dated-offset.jpg");
    await backfillExif(db, {});
    // Gone from disk: a second read would find nothing and change nothing
    // either, so count what the pass looks at instead.
    fs.rmSync(path.join(root, "a.jpg"));
    let total = -1;
    expect(await backfillExif(db, { onProgress: (_d, t) => (total = t) })).toBe(
      0,
    );
    expect(total).toBe(-1); // no progress: nothing to do
    expect(rowOf(id).exif).not.toBeNull();
  });

  it("leaves a photo it cannot read to the next scan, and goes on", async () => {
    const missing = photo("gone.jpg", null);
    const dated = photo("a.jpg", "dated-offset.jpg");
    expect(await backfillExif(db, {})).toBe(1);
    expect(rowOf(missing).exif).toBeNull();
    expect(rowOf(dated).captured_at).toBe(TAKEN);
  });

  it("skips the photos it is told to", async () => {
    const id = photo("a.jpg", "dated-offset.jpg");
    await backfillExif(db, { skip: (rel) => rel === "a.jpg" });
    expect(rowOf(id).exif).toBeNull();
  });

  it("leaves videos and audio alone", async () => {
    fs.copyFileSync(fixture("dated-offset.jpg"), path.join(root, "v.mp4"));
    const video = insertFile(db, rootId, { relPath: "v.mp4", root });
    expect(await backfillExif(db, {})).toBe(0);
    expect(rowOf(video).exif).toBeNull();
  });

  it("keeps what it read before being stopped", async () => {
    const first = photo("a.jpg", "dated-offset.jpg");
    const ac = new AbortController();
    await backfillExif(db, {
      signal: ac.signal,
      onProgress: () => ac.abort(),
    });
    expect(rowOf(first).exif).not.toBeNull();
  });
});
