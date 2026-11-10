import { describe, expect, it } from "vitest";
import type { DuplicateGroup, FileRow } from "@/ipc/types";
import { sampleFileRow } from "@/test/fixtures";
import { oldestCopy, reclaimBarPercent, visibleGroups } from "../groupView";

function file(id: number, relPath: string, patch: Partial<FileRow> = {}) {
  return { ...sampleFileRow, id, relPath, ...patch };
}

function group(hash: string, size: number, files: FileRow[]): DuplicateGroup {
  return { contentHash: hash, size, files };
}

// Server order: reclaimable bytes descending (300, 200, 100).
const big = group("a", 100, [
  file(1, "v/big.mp4", { addedAt: 10 }),
  file(2, "w/big.mp4", { addedAt: 20 }),
  file(3, "x/big.mp4", { addedAt: 30 }),
  file(4, "y/big.mp4", { addedAt: 40 }),
]);
const photo = group("b", 200, [
  file(5, "p/photo.jpg", { kind: "image", addedAt: 50 }),
  file(6, "q/photo.jpg", { kind: "image", addedAt: 60 }),
]);
const song = group("c", 50, [
  file(7, "m/song.flac", { kind: "audio", addedAt: 70 }),
  file(8, "n/song.flac", { kind: "audio", addedAt: 5 }),
  file(9, "o/song.flac", { kind: "audio", addedAt: 6 }),
]);
const groups = [big, photo, song];
const all = { query: "", kind: "all", sort: "reclaimable" } as const;

describe("visibleGroups", () => {
  it("keeps the server order for the reclaimable sort", () => {
    expect(visibleGroups(groups, all)).toEqual([big, photo, song]);
  });

  it("sorts by size, copy count and latest added copy", () => {
    expect(visibleGroups(groups, { ...all, sort: "size" })).toEqual([
      photo,
      big,
      song,
    ]);
    expect(visibleGroups(groups, { ...all, sort: "count" })).toEqual([
      big,
      song,
      photo,
    ]);
    expect(visibleGroups(groups, { ...all, sort: "added" })).toEqual([
      song,
      photo,
      big,
    ]);
  });

  it("filters by kind and by a case-insensitive path match", () => {
    expect(visibleGroups(groups, { ...all, kind: "image" })).toEqual([photo]);
    expect(visibleGroups(groups, { ...all, query: " Q/PHO " })).toEqual([
      photo,
    ]);
  });

  it("matches a group when any copy is of the kind", () => {
    const mixed = group("d", 10, [
      file(10, "a/x.mp4"),
      file(11, "b/x.m4a", { kind: "audio" }),
    ]);
    expect(visibleGroups([mixed], { ...all, kind: "audio" })).toEqual([mixed]);
  });

  it("requires every whitespace-separated word in one copy's path", () => {
    const trip = group("e", 10, [
      file(12, "2020/beach.mp4"),
      file(13, "misc/beach.mp4"),
    ]);
    expect(visibleGroups([trip], { ...all, query: "beach 2020" })).toEqual([
      trip,
    ]);
    // Each word appears in some copy, but not both in the same one.
    expect(visibleGroups([trip], { ...all, query: "misc 2020" })).toEqual([]);
  });

  it("does not reorder the input", () => {
    visibleGroups(groups, { ...all, sort: "size" });
    expect(groups).toEqual([big, photo, song]);
  });
});

describe("oldestCopy", () => {
  it("returns the copy indexed first", () => {
    expect(oldestCopy(song.files)?.id).toBe(8);
  });

  it("returns null when the earliest time is shared", () => {
    expect(
      oldestCopy([file(1, "a", { addedAt: 1 }), file(2, "b", { addedAt: 1 })]),
    ).toBeNull();
  });
});

describe("reclaimBarPercent", () => {
  it("scales to the largest group with a minimum sliver", () => {
    expect(reclaimBarPercent(50, 200)).toBe(25);
    expect(reclaimBarPercent(1, 1000)).toBe(2);
  });

  it("draws no bar for a group that frees nothing", () => {
    expect(reclaimBarPercent(0, 200)).toBe(0);
    expect(reclaimBarPercent(0, 0)).toBe(0);
  });
});
