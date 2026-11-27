// Regression tests for bulkSetMeta: the write behind the selection bar's
// favorite and rating controls.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  bulkSetMeta,
  searchFiles,
  setFavorite,
  setRating,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("bulkSetMeta", () => {
  let db: DB;
  let rootId: number;
  let ids: number[];

  beforeEach(() => {
    ({ db, rootId } = newDb());
    ids = ["a.mp4", "b.mp4", "c.mp4"].map((relPath, i) =>
      insertFile(db, rootId, { relPath, contentHash: `h${i}` }),
    );
  });
  afterEach(() => db.close());

  /** Read back through the query layer the list actually renders from. */
  const rowsById = () => {
    const map = new Map<number, { favorite: number; rating: number }>();
    for (const f of searchFiles(db, {}).items) {
      map.set(f.id, { favorite: f.favorite, rating: f.rating });
    }
    return map;
  };

  it("sets a flag across the selection", () => {
    expect(bulkSetMeta(db, ids, { favorite: true })).toEqual({
      files: 3,
      skipped: 0,
    });
    for (const id of ids) expect(rowsById().get(id)?.favorite).toBe(1);
  });

  it("clears a flag across the selection", () => {
    setFavorite(db, ids[0], true);
    expect(bulkSetMeta(db, ids, { favorite: false }).files).toBe(3);
    for (const id of ids) expect(rowsById().get(id)?.favorite).toBe(0);
  });

  it("sets a rating and clamps it", () => {
    bulkSetMeta(db, ids, { rating: 4 });
    expect(rowsById().get(ids[0])?.rating).toBe(4);
    bulkSetMeta(db, ids, { rating: 99 });
    expect(rowsById().get(ids[0])?.rating).toBe(5);
    bulkSetMeta(db, ids, { rating: -3 });
    expect(rowsById().get(ids[0])?.rating).toBe(0);
  });

  it("writes both fields in one pass", () => {
    bulkSetMeta(db, ids, { favorite: true, rating: 2 });
    const row = rowsById().get(ids[1]);
    expect(row).toEqual({ favorite: 1, rating: 2 });
  });

  it("leaves the field it was not asked to set alone", () => {
    setRating(db, ids[0], 5);
    bulkSetMeta(db, ids, { favorite: true });
    expect(rowsById().get(ids[0])).toEqual({ favorite: 1, rating: 5 });
  });

  it("counts a missing file row as skipped", () => {
    db.prepare("DELETE FROM files WHERE id = ?").run(ids[1]);
    expect(bulkSetMeta(db, ids, { favorite: true })).toEqual({
      files: 2,
      skipped: 1,
    });
  });

  it("does nothing without a field to set", () => {
    expect(bulkSetMeta(db, ids, {})).toEqual({ files: 0, skipped: 0 });
  });

  it("does nothing for an empty selection", () => {
    expect(bulkSetMeta(db, [], { favorite: true })).toEqual({
      files: 0,
      skipped: 0,
    });
  });

  it("counts both copies of a file that shares a content hash", () => {
    // file_meta is keyed by meta_key, so the two rows resolve to one write —
    // but both are files the user selected, and both now read as favorites.
    const twinA = insertFile(db, rootId, {
      relPath: "dup-a.mp4",
      contentHash: "d",
    });
    const twinB = insertFile(db, rootId, {
      relPath: "dup-b.mp4",
      contentHash: "d",
    });
    expect(bulkSetMeta(db, [twinA, twinB], { favorite: true }).files).toBe(2);
    expect(rowsById().get(twinA)?.favorite).toBe(1);
    expect(rowsById().get(twinB)?.favorite).toBe(1);
  });

  it("deduplicates repeated file ids", () => {
    expect(
      bulkSetMeta(db, [ids[0], ids[0], ids[1]], { favorite: true }).files,
    ).toBe(2);
  });
});
