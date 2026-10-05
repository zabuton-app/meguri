import { describe, expect, it } from "vitest";
import {
  THUMBNAIL_GAP as GAP,
  THUMBNAIL_HEIGHT as H,
  THUMBNAIL_MARGIN as MARGIN,
  THUMBNAIL_MIN_SIDE as MIN,
  THUMBNAIL_WIDTH as W,
  fitThumbnail,
  thumbnailPosition,
} from "../model/hoverThumbnail";

describe("fitThumbnail", () => {
  it("fills the width for a picture wider than the box", () => {
    expect(fitThumbnail(1920, 1080)).toEqual({ width: W, height: 108 });
  });

  it("fills the height for a picture taller than the box", () => {
    expect(fitThumbnail(1080, 1920)).toEqual({ width: 81, height: H });
  });

  it("scales a small picture up to the box", () => {
    expect(fitThumbnail(40, 40)).toEqual({ width: H, height: H });
  });

  it("crops a sliver rather than showing a line", () => {
    expect(fitThumbnail(800, 20000)).toEqual({ width: MIN, height: H });
    expect(fitThumbnail(10000, 10)).toEqual({ width: W, height: MIN });
  });

  it("takes the whole box while the size is unknown", () => {
    expect(fitThumbnail(0, 0)).toEqual({ width: W, height: H });
  });
});

describe("thumbnailPosition", () => {
  it("sits up and to the right of the pointer", () => {
    expect(thumbnailPosition(400, 300, 1000, 800)).toEqual({
      left: 400 + GAP,
      top: 300 - GAP - H,
    });
  });

  it("flips to the left near the right edge", () => {
    expect(thumbnailPosition(950, 300, 1000, 800).left).toBe(950 - GAP - W);
  });

  it("flips below the pointer near the top edge", () => {
    expect(thumbnailPosition(400, 50, 1000, 800).top).toBe(50 + GAP);
  });

  it("keeps a smaller card next to the pointer", () => {
    expect(thumbnailPosition(400, 300, 1000, 800, 81, 100)).toEqual({
      left: 400 + GAP,
      top: 300 - GAP - 100,
    });
    expect(thumbnailPosition(950, 300, 1000, 800, 81, 100).left).toBe(
      950 - GAP - 81,
    );
  });

  it("stays inside a box too small to flip in", () => {
    const boxWidth = W + 28;
    const boxHeight = H + 56;
    expect(thumbnailPosition(100, 100, boxWidth, boxHeight)).toEqual({
      left: MARGIN,
      top: boxHeight - H - MARGIN,
    });
  });
});
