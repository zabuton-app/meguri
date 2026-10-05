import { describe, expect, it } from "vitest";
import {
  THUMBNAIL_GAP as GAP,
  THUMBNAIL_HEIGHT as H,
  THUMBNAIL_MARGIN as MARGIN,
  THUMBNAIL_WIDTH as W,
  thumbnailPosition,
} from "../model/hoverThumbnail";

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

  it("stays inside a box too small to flip in", () => {
    const boxWidth = W + 28;
    const boxHeight = H + 56;
    expect(thumbnailPosition(100, 100, boxWidth, boxHeight)).toEqual({
      left: MARGIN,
      top: boxHeight - H - MARGIN,
    });
  });
});
