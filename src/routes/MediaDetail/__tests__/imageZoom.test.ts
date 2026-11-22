// The zoom and pan math of the detail view's image (#633).
import { describe, expect, it } from "vitest";
import {
  imagePointAt,
  MAX_ZOOM,
  panBy,
  placeImage,
  wheelFactor,
  zoomTo,
} from "@/routes/MediaDetail/imageZoom";

// A 4000 × 2000 photo in a 1000 × 800 viewport.
const image = { w: 4000, h: 2000 };
const viewport = { w: 1000, h: 800 };

describe("imageZoom", () => {
  it("keeps the spot under the pointer in place", () => {
    const v = zoomTo(1, 0.3, 0.6, 200, 500, viewport, image);
    const p = placeImage(v, viewport, image);
    expect(p.width).toBe(4000);
    expect(p.left + 0.3 * p.width).toBeCloseTo(200);
    expect(p.top + 0.6 * p.height).toBeCloseTo(500);

    // Zooming again at the same point keeps the same spot under it.
    const at = imagePointAt(v, 200, 500, viewport, image);
    const w = zoomTo(2, at.x, at.y, 200, 500, viewport, image);
    const q = placeImage(w, viewport, image);
    expect(q.left + 0.3 * q.width).toBeCloseTo(200);
    expect(q.top + 0.6 * q.height).toBeCloseTo(500);
  });

  it("centers an axis the image does not fill", () => {
    // 0.4×: 1600 × 800, so it fills the height exactly; 0.3×: 1200 × 600.
    const v = zoomTo(0.3, 0.1, 0.1, 0, 0, viewport, image);
    const p = placeImage(v, viewport, image);
    expect(p.top).toBe(100);
    expect(p.left).toBeLessThanOrEqual(0);
  });

  it("does not show a gap at an edge the image is wider than", () => {
    // The image's left edge asked for at the viewport's middle.
    const v = zoomTo(1, 0, 0, 500, 400, viewport, image);
    const p = placeImage(v, viewport, image);
    expect(p.left).toBe(0);
    expect(p.top).toBe(0);
  });

  it("pans, and stops at the edges", () => {
    const v = zoomTo(1, 0.5, 0.5, 500, 400, viewport, image);
    const before = placeImage(v, viewport, image);
    const moved = placeImage(
      panBy(v, -100, 50, viewport, image),
      viewport,
      image,
    );
    expect(moved.left).toBeCloseTo(before.left - 100);
    expect(moved.top).toBeCloseTo(before.top + 50);

    // Pushed far past the right edge, then back: it moves at once.
    const pushed = panBy(v, -10_000, 0, viewport, image);
    expect(placeImage(pushed, viewport, image).left).toBe(-3000);
    const back = panBy(pushed, 100, 0, viewport, image);
    expect(placeImage(back, viewport, image).left).toBeCloseTo(-2900);
  });

  it("caps the zoom at 800%", () => {
    expect(MAX_ZOOM).toBe(8);
    expect(zoomTo(50, 0.5, 0.5, 500, 400, viewport, image).zoom).toBe(8);
  });

  it("zooms in for a wheel turned forward and out for one turned back", () => {
    expect(wheelFactor(-100)).toBeCloseTo(1.2);
    expect(wheelFactor(100)).toBeCloseTo(1 / 1.2);
  });
});
