import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { newDb } from "./helpers.js";
import { walk, walkChanges, syncFiles } from "../scan.js";
import { searchFiles, setRating } from "../queries.js";
import { runScan } from "../jobs.js";
import type { Core } from "../index.js";

describe("targeted watch-folder updates", () => {
  let root: string;
  let database: ReturnType<typeof newDb>;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "meguri-watch-"));
    database = newDb();
    await fs.writeFile(path.join(root, "original.mp4"), "original contents");
    await fs.writeFile(path.join(root, "untouched.mp4"), "unrelated contents");
    await syncFiles(database.db, database.rootId, await walk(root));
  });
  afterEach(async () => {
    database.db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const names = () =>
    searchFiles(database.db, {})
      .items.map((f) => f.relPath)
      .sort();
  async function apply(paths: string[]) {
    const delta = await walkChanges(database.db, database.rootId, root, paths);
    return syncFiles(
      database.db,
      database.rootId,
      delta.discovered,
      undefined,
      undefined,
      delta.scope,
    );
  }

  it("inserts a copy without stealing its original row or deleting untouched files", async () => {
    const original = searchFiles(database.db, {}).items.find(
      (f) => f.relPath === "original.mp4",
    )!;
    setRating(database.db, original.id, 5);
    await fs.copyFile(
      path.join(root, "original.mp4"),
      path.join(root, "copy.mp4"),
    );
    const result = await apply(["copy.mp4"]);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.moved).toBe(0);
    expect(result.stats.unchanged).toBe(0);
    expect(names()).toEqual(["copy.mp4", "original.mp4", "untouched.mp4"]);
    expect(
      searchFiles(database.db, {}).items.find((f) => f.id === original.id)
        ?.relPath,
    ).toBe("original.mp4");
    expect(
      searchFiles(database.db, {}).items.find((f) => f.id === original.id)
        ?.rating,
    ).toBe(5);
  });

  it("preserves identity and rating on a notified rename, then deletes only the notified file", async () => {
    const original = searchFiles(database.db, {}).items.find(
      (f) => f.relPath === "original.mp4",
    )!;
    setRating(database.db, original.id, 4);
    await fs.rename(
      path.join(root, "original.mp4"),
      path.join(root, "renamed.mp4"),
    );
    expect((await apply(["original.mp4", "renamed.mp4"])).stats.moved).toBe(1);
    expect(
      searchFiles(database.db, {}).items.find((f) => f.id === original.id)
        ?.rating,
    ).toBe(4);
    await fs.unlink(path.join(root, "renamed.mp4"));
    expect((await apply(["renamed.mp4"])).stats.deleted).toBe(1);
    expect(names()).toEqual(["untouched.mp4"]);
  });

  it("walks a new subtree once and ignores browser partials, hidden paths and escapes", async () => {
    await fs.mkdir(path.join(root, "batch"));
    await fs.writeFile(path.join(root, "batch", "new.png"), "new media");
    await fs.mkdir(path.join(root, "pending.download"));
    await fs.writeFile(
      path.join(root, "pending.download", "partial.mp4"),
      "not finished",
    );
    await fs.writeFile(path.join(root, "half.mp4.crdownload"), "not finished");
    const result = await apply([
      "batch",
      path.join("batch", "new.png"),
      "half.mp4.crdownload",
      "pending.download",
      "../outside.mp4",
      ".hidden.mp4",
    ]);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.deleted).toBe(0);
    expect(names()).toEqual(
      [path.join("batch", "new.png"), "original.mp4", "untouched.mp4"].sort(),
    );
  });

  it("does not follow a symlink outside the scanned root", async () => {
    await fs.symlink(os.tmpdir(), path.join(root, "outside"), "dir");
    const result = await apply(["outside"]);
    expect(result.stats.inserted).toBe(0);
    expect(result.stats.deleted).toBe(0);
  });

  it("refuses a missing drive instead of clearing the catalogue", async () => {
    const moved = root + "-offline";
    await fs.rename(root, moved);
    try {
      await expect(
        runScan(
          { db: database.db, rootId: database.rootId, root } as Core,
          "offline",
          () => {},
        ),
      ).rejects.toThrow();
    } finally {
      await fs.rename(moved, root);
    }
    expect(names()).toHaveLength(2);
  });

  it("keeps the original discovery date when rebuilding an existing path", async () => {
    // Exercise the full rebuild pipeline with a valid image, not a stubbed probe.
    await fs.copyFile(
      path.resolve("e2e/fixtures/media/test.png"),
      path.join(root, "kept.png"),
    );
    await syncFiles(database.db, database.rootId, await walk(root));
    database.db
      .prepare("UPDATE files SET created_at = ? WHERE rel_path = ?")
      .run(1000000000, "kept.png");
    await fs.unlink(path.join(root, "original.mp4"));
    await fs.unlink(path.join(root, "untouched.mp4"));
    const thumbs = path.join(root, ".thumbs");
    await fs.mkdir(thumbs);
    await runScan(
      {
        db: database.db,
        rootId: database.rootId,
        root,
        thumbsDir: () => thumbs,
      } as Core,
      "rebuild",
      () => {},
      { rebuild: true },
    );
    expect(
      searchFiles(database.db, {}).items.find((f) => f.relPath === "kept.png")
        ?.addedAt,
    ).toBe(1000000000);
  });
});
