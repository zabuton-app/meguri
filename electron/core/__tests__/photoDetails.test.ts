// file_photo_details' resolution of a file id to what the detail view lists
// (#725).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { photoDetailsOf } from "../photoDetails.js";
import { insertFile, newDb } from "./helpers.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/exif/${name}`, import.meta.url));

describe("photoDetailsOf", () => {
  let db: DB;
  let rootId: number;
  let root: string;
  let outside: string;

  beforeEach(() => {
    ({ db, rootId } = newDb());
    root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-photo-details-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-outside-"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const photo = (relPath: string, kind: "image" | "video" = "image") =>
    insertFile(db, rootId, { relPath, root, kind });

  it("reads a photo inside the root", async () => {
    fs.copyFileSync(fixture("full.jpg"), path.join(root, "a.jpg"));
    const r = await photoDetailsOf({ db, root }, photo("a.jpg"));
    expect(r?.status).toBe("ok");
  });

  it("says a photo that went away (an unmounted share) is unreadable", async () => {
    expect(await photoDetailsOf({ db, root }, photo("gone.jpg"))).toEqual({
      status: "unreadable",
    });
  });

  it("does not read a photo whose link leads outside the root", async () => {
    fs.copyFileSync(fixture("full.jpg"), path.join(outside, "x.jpg"));
    fs.symlinkSync(path.join(outside, "x.jpg"), path.join(root, "link.jpg"));
    expect(await photoDetailsOf({ db, root }, photo("link.jpg"))).toEqual({
      status: "unreadable",
    });
  });

  it("is null for a video, or a file the index does not have", async () => {
    fs.copyFileSync(fixture("full.jpg"), path.join(root, "v.mp4"));
    expect(await photoDetailsOf({ db, root }, photo("v.mp4", "video"))).toBe(
      null,
    );
    expect(await photoDetailsOf({ db, root }, 9999)).toBe(null);
  });
});
