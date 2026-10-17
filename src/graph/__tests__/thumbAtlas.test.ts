import { describe, expect, it } from "vitest";
import { DISPLAY_RANGE } from "../graphSettings";
import {
  CELL,
  CELLS,
  COLUMNS,
  CellTable,
  atlasHeight,
  cellOrigin,
  coverCrop,
} from "../render/thumbAtlas";

describe("CellTable", () => {
  it("keeps a file in its cell, loading once per version", () => {
    const t = new CellTable(4);
    expect(t.claim("a", 1, 1)).toEqual({ index: 0, load: true });
    expect(t.claim("b", 1, 1)).toEqual({ index: 1, load: true });
    expect(t.claim("a", 1, 2)).toEqual({ index: 0, load: false });
    expect(t.lookup("a")).toEqual({
      index: 0,
      status: "loading",
      drawn: false,
    });
    expect(t.settle(0, "a", 1, "ready")).toBe(true);
    expect(t.lookup("a")?.status).toBe("ready");
  });

  it("loads a regenerated picture into the same cell, dropping the stale load", () => {
    const t = new CellTable(4);
    t.claim("a", 1, 1);
    expect(t.claim("a", 2, 2)).toEqual({ index: 0, load: true });
    expect(t.lookup("a")?.status).toBe("loading");
    // The load of version 1 lands after the cell moved on.
    expect(t.settle(0, "a", 1, "ready")).toBe(false);
    expect(t.lookup("a")?.status).toBe("loading");
    expect(t.settle(0, "a", 2, "ready")).toBe(true);
    // A newer version of a ready picture loads again.
    expect(t.claim("a", 3, 3).load).toBe(true);
  });

  it("does not try a failed picture again until its version changes", () => {
    const t = new CellTable(4);
    t.claim("a", 1, 1);
    t.settle(0, "a", 1, "error");
    expect(t.claim("a", 1, 2).load).toBe(false);
    expect(t.lookup("a")?.status).toBe("error");
    expect(t.claim("a", 2, 3).load).toBe(true);
  });

  it("gives up the cell used longest ago once all are taken", () => {
    const t = new CellTable(2);
    t.claim("a", 1, 1);
    t.claim("b", 1, 1);
    t.claim("a", 1, 2); // a is wanted again; b is now the oldest
    expect(t.claim("c", 1, 3)).toEqual({ index: 1, load: true });
    expect(t.lookup("b")).toBeUndefined();
    expect(t.lookup("a")?.index).toBe(0);
    // The evicted file's load, still under way, is stale.
    expect(t.settle(1, "b", 1, "ready")).toBe(false);
  });

  it("gives a new file the cell of one not wanted any more before an empty one", () => {
    const t = new CellTable(4);
    t.claim("a", 1, 1);
    t.claim("b", 1, 1);
    // The filter changed: only b is wanted, and c is new.
    t.claim("b", 1, 2);
    expect(t.claim("c", 1, 2)).toEqual({ index: 0, load: true });
    expect(t.lookup("a")).toBeUndefined();
    expect(t.extent).toBe(2);
    // With every cell wanted now, an empty one is taken.
    t.claim("b", 1, 3);
    t.claim("c", 1, 3);
    expect(t.claim("d", 1, 3)).toEqual({ index: 2, load: true });
  });

  it("keeps the old picture on show while its new version loads, or fails", () => {
    const t = new CellTable(4);
    t.claim("a", 1, 1);
    expect(t.lookup("a")?.drawn).toBe(false);
    t.settle(0, "a", 1, "ready");
    t.claim("a", 2, 2);
    expect(t.lookup("a")).toEqual({ index: 0, status: "loading", drawn: true });
    t.settle(0, "a", 2, "error");
    expect(t.lookup("a")).toEqual({ index: 0, status: "error", drawn: true });
  });

  it("knows how far the cells in use reach", () => {
    const t = new CellTable(8);
    expect(t.extent).toBe(0);
    t.claim("a", 1, 1);
    t.claim("b", 1, 1);
    expect(t.extent).toBe(2);
  });
});

describe("coverCrop", () => {
  it("keeps the centred square", () => {
    expect(coverCrop(200, 100)).toEqual({ sx: 50, sy: 0, size: 100 });
    expect(coverCrop(90, 160)).toEqual({ sx: 0, sy: 35, size: 90 });
    expect(coverCrop(64, 64)).toEqual({ sx: 0, sy: 0, size: 64 });
  });

  it("has nothing to keep of a picture without a size", () => {
    expect(coverCrop(0, 100)).toBeNull();
    expect(coverCrop(100, Number.NaN)).toBeNull();
  });
});

describe("atlas layout", () => {
  it("has a cell for every file the largest limit lets through", () => {
    // Fewer, and the files on show would take each other's cells in turn.
    expect(CELLS).toBeGreaterThanOrEqual(DISPLAY_RANGE.thumbnailLimit[1]);
  });

  it("grows in whole rows, doubling from four", () => {
    expect(atlasHeight(0)).toBe(4 * CELL);
    expect(atlasHeight(4 * COLUMNS)).toBe(4 * CELL);
    expect(atlasHeight(4 * COLUMNS + 1)).toBe(8 * CELL);
    expect(atlasHeight(1024)).toBe(32 * CELL);
  });

  it("places cells row by row", () => {
    expect(cellOrigin(0)).toEqual({ x: 0, y: 0 });
    expect(cellOrigin(COLUMNS - 1)).toEqual({ x: (COLUMNS - 1) * CELL, y: 0 });
    expect(cellOrigin(COLUMNS + 2)).toEqual({ x: 2 * CELL, y: CELL });
  });
});
