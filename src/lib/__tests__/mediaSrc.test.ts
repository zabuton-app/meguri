import { describe, expect, it } from "vitest";
import {
  isSameMediaSource,
  streamOffsetOf,
  withoutStreamSeek,
  withStreamSeek,
} from "@/lib/mediaSrc";

const SRC = "http://127.0.0.1:1/ws/ws1/media/7";

describe("mediaSrc", () => {
  it("re-serves from a whole second", () => {
    expect(withStreamSeek(SRC, 90.7)).toBe(`${SRC}?t=90`);
    // Replaces an earlier seek rather than stacking a second parameter.
    expect(withStreamSeek(`${SRC}?t=10`, 42)).toBe(`${SRC}?t=42`);
  });

  it("compares sources regardless of the second they are served from", () => {
    expect(isSameMediaSource(`${SRC}?t=90`, SRC)).toBe(true);
    expect(isSameMediaSource(`${SRC}?t=90`, `${SRC}?t=10`)).toBe(true);
    expect(isSameMediaSource(SRC, "http://127.0.0.1:1/ws/ws1/media/8")).toBe(
      false,
    );
    // Only `t` is ignored; any other query still tells sources apart.
    expect(isSameMediaSource(`${SRC}?v=1`, `${SRC}?v=2`)).toBe(false);
    expect(isSameMediaSource(null, "")).toBe(true);
  });

  it("reads the offset back, and 0 when served from the top", () => {
    expect(streamOffsetOf(`${SRC}?t=90`)).toBe(90);
    expect(streamOffsetOf(SRC)).toBe(0);
    expect(streamOffsetOf(null)).toBe(0);
    expect(withoutStreamSeek(`${SRC}?t=90`)).toBe(SRC);
  });
});
