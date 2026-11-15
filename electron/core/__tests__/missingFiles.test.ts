// Files a scan no longer found on disk: listing them and removing the ones the
// user picks (#277).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  countMissingFiles,
  listMissingFiles,
  purgeMissingFiles,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("missing files", () => {
  let db: DB;
  let alive: number;
  let goneOld: number;
  let goneNew: number;
  let excluded: number;

  beforeEach(() => {
    const created = newDb();
    db = created.db;
    const add = (relPath: string) =>
      insertFile(db, created.rootId, { relPath, contentHash: relPath });
    alive = add("alive.mp4");
    goneOld = add("old.mp4");
    goneNew = add("new.mp4");
    excluded = add("excluded.mp4");
    db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").run(
      100,
      goneOld,
    );
    db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").run(
      200,
      goneNew,
    );
    // Removed from the index by the user: part of the exclusion list.
    db.prepare(
      "UPDATE files SET deleted_at = 150, excluded_at = 150 WHERE id = ?",
    ).run(excluded);
    db.exec(
      "INSERT INTO files_fts (rowid, rel_path, tags_text) SELECT id, rel_path, '' FROM files",
    );
  });
  afterEach(() => db.close());

  const ids = () =>
    db.prepare("SELECT id FROM files ORDER BY id").pluck().all() as number[];
  const ftsIds = () =>
    db
      .prepare("SELECT rowid FROM files_fts ORDER BY rowid")
      .pluck()
      .all() as number[];

  it("lists files gone from disk, the most recently gone first", () => {
    expect(
      listMissingFiles(db, 10).map((r) => [r.id, r.relPath, r.deletedAt]),
    ).toEqual([
      [goneNew, "new.mp4", 200],
      [goneOld, "old.mp4", 100],
    ]);
    expect(countMissingFiles(db)).toBe(2);
  });

  it("lists at most the limit, through its own index", () => {
    expect(listMissingFiles(db, 1).map((r) => r.id)).toEqual([goneNew]);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT f.id FROM files f INDEXED BY idx_files_missing
         WHERE f.deleted_at IS NOT NULL AND f.excluded_at IS NULL
         ORDER BY f.deleted_at DESC, f.id DESC LIMIT 1`,
      )
      .all() as { detail: string }[];
    const details = plan.map((p) => p.detail).join("; ");
    expect(details).toContain("idx_files_missing");
    expect(details).not.toContain("TEMP B-TREE");
  });

  it("removes the picked files and their search entries", () => {
    expect(purgeMissingFiles(db, [goneOld])).toEqual([goneOld]);
    expect(ids()).toEqual([alive, goneNew, excluded]);
    expect(ftsIds()).toEqual([alive, goneNew, excluded]);
  });

  it("leaves files that are back, still listed in the index, or excluded", () => {
    // Came back after the list was shown.
    db.prepare("UPDATE files SET deleted_at = NULL WHERE id = ?").run(goneNew);
    expect(purgeMissingFiles(db, [alive, goneNew, excluded])).toEqual([]);
    expect(ids()).toEqual([alive, goneOld, goneNew, excluded]);
  });

  it("does nothing for an empty list", () => {
    expect(purgeMissingFiles(db, [])).toEqual([]);
    expect(ids()).toHaveLength(4);
  });
});
