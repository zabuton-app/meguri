import { describe, expect, it } from "vitest";
import {
  FILES_SEARCH_PAGE_SIZE,
  filesSearchListOffset,
  filesSearchPreviousCursor,
  isHeadPage,
} from "@/lib/filesSearch";

describe("filesSearchPreviousCursor", () => {
  it("returns undefined at the start of the list", () => {
    expect(filesSearchPreviousCursor(undefined)).toBeUndefined();
    expect(filesSearchPreviousCursor(0)).toBeUndefined();
  });

  it("steps back one page at a time", () => {
    expect(filesSearchPreviousCursor(FILES_SEARCH_PAGE_SIZE)).toBe(0);
    expect(filesSearchPreviousCursor(FILES_SEARCH_PAGE_SIZE * 2)).toBe(
      FILES_SEARCH_PAGE_SIZE,
    );
  });

  it("reads the offset out of a keyset cursor and returns an offset-only cursor", () => {
    const keyed = {
      offset: FILES_SEARCH_PAGE_SIZE * 3,
      key: { v: "a.mp4", ws: "ws1", id: 42 },
    };
    expect(filesSearchPreviousCursor(keyed)).toBe(FILES_SEARCH_PAGE_SIZE * 2);
    expect(filesSearchPreviousCursor({ offset: 0 })).toBeUndefined();
  });
});

describe("a window that does not start on a page boundary", () => {
  // The timeline opens the list at a month: an offset of its own.
  const keyed = { offset: 237, key: { v: 1_700_000_000, ws: "", id: 0 } };

  it("steps back a full page while one fits above the window", () => {
    expect(filesSearchPreviousCursor(keyed)).toBe(137);
    expect(filesSearchPreviousCursor(137)).toBe(37);
  });

  it("ends with the rows left above, not a page overlapping the window", () => {
    const head = filesSearchPreviousCursor(37);
    expect(head).toEqual({ offset: 0, size: 37 });
    expect(isHeadPage(head)).toBe(true);
    expect(filesSearchPreviousCursor(head)).toBeUndefined();
    expect(filesSearchListOffset([head])).toBe(0);
  });

  it("does not take a cursor for a head page", () => {
    expect(isHeadPage(keyed)).toBe(false);
    expect(isHeadPage(100)).toBe(false);
    expect(isHeadPage(undefined)).toBe(false);
  });
});

describe("filesSearchListOffset", () => {
  it("reads the first page cursor as the list offset", () => {
    expect(filesSearchListOffset([undefined])).toBe(0);
    expect(filesSearchListOffset([200])).toBe(200);
    expect(filesSearchListOffset(undefined)).toBe(0);
  });

  it("reads the offset from a keyset cursor", () => {
    expect(
      filesSearchListOffset([
        { offset: 500, key: { v: null, ws: "w", id: 1 } },
      ]),
    ).toBe(500);
  });
});
