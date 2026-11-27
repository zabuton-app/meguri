import { describe, expect, it } from "vitest";
import { fitFrameCount, frameTimes, frameWidthFor } from "@/filmstrip/frames";

describe("frameTimes", () => {
  it("spaces frames evenly at the middle of each slice, in whole seconds", () => {
    expect(frameTimes(100, 4)).toEqual([12, 37, 62, 87]);
  });

  it("puts every frame of a very short clip at 0", () => {
    expect(frameTimes(1, 3)).toEqual([0, 0, 0]);
  });
});

describe("fitFrameCount", () => {
  it("fits as many frames as the strip holds, gaps between them", () => {
    expect(fitFrameCount(1000, 120, 4)).toBe(8);
  });

  it("keeps at least one frame on a narrow strip", () => {
    expect(fitFrameCount(50, 120, 4)).toBe(1);
    expect(fitFrameCount(0, 120, 4)).toBe(1);
  });
});

describe("frameWidthFor", () => {
  it("uses 16:9 when the size is unknown", () => {
    expect(frameWidthFor(90, null, null)).toBe(160);
    expect(frameWidthFor(90, 0, 1080)).toBe(160);
  });

  it("follows the video's aspect ratio", () => {
    expect(frameWidthFor(90, 1080, 1920)).toBe(50.625);
  });
});
