import { describe, expect, it } from "vitest";
import { frameTimes, stripLayout } from "@/filmstrip/frames";

describe("frameTimes", () => {
  it("spaces frames evenly at the middle of each slice, in whole seconds", () => {
    expect(frameTimes(100, 4)).toEqual([12, 37, 62, 87]);
  });

  it("puts every frame of a very short clip at 0", () => {
    expect(frameTimes(1, 3)).toEqual([0, 0, 0]);
  });
});

describe("stripLayout", () => {
  it("shares the strip's width among 16:9 frames, gaps between them", () => {
    // (1288 - 9 gaps of 4) / 10 = 125.2 → 125 wide, 70 high.
    expect(stripLayout(1288, 10)).toEqual({
      frameW: 125,
      frameH: 70,
      scrolls: false,
    });
  });

  it("keeps a frame at its minimum width and scrolls a strip too narrow for it", () => {
    expect(stripLayout(500, 10)).toEqual({
      frameW: 64,
      frameH: 36,
      scrolls: true,
    });
    // An unmeasured strip (width 0) too.
    expect(stripLayout(0, 10).frameW).toBe(64);
  });
});
