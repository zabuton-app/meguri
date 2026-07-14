import { describe, expect, it } from "vitest";
import {
  FILES_SEARCH_PAGE_SIZE,
  filesSearchListOffset,
  filesSearchPreviousCursor,
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
});

describe("filesSearchListOffset", () => {
  it("reads the first page cursor as the list offset", () => {
    expect(filesSearchListOffset([undefined])).toBe(0);
    expect(filesSearchListOffset([200])).toBe(200);
    expect(filesSearchListOffset(undefined)).toBe(0);
  });
});
