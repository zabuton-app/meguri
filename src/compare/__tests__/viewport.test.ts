import { describe, expect, it } from "vitest";
import { MAX_ZOOM, fitScale, zoomAt } from "../viewport";

describe("fitScale", () => {
  it("fits the box by its tighter side", () => {
    expect(
      fitScale({ width: 200, height: 100 }, { width: 400, height: 100 }),
    ).toBe(1);
    expect(
      fitScale({ width: 200, height: 100 }, { width: 100, height: 400 }),
    ).toBe(0.5);
  });

  it("is 1 for an empty box", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 300 })).toBe(
      1,
    );
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor in place", () => {
    const view = { zoom: 1, panX: 10, panY: -5 };
    const at = { x: 50, y: 30 };
    const next = zoomAt(view, 2, at);
    expect(next.zoom).toBe(2);
    // The content point under `at` before: (at - pan) / zoom; after, the same.
    expect((at.x - next.panX) / next.zoom).toBeCloseTo(
      (at.x - view.panX) / view.zoom,
    );
    expect((at.y - next.panY) / next.zoom).toBeCloseTo(
      (at.y - view.panY) / view.zoom,
    );
  });

  it("stops at fit and at the largest zoom", () => {
    expect(
      zoomAt({ zoom: 1, panX: 0, panY: 0 }, 0.5, { x: 0, y: 0 }).zoom,
    ).toBe(1);
    expect(
      zoomAt({ zoom: MAX_ZOOM, panX: 0, panY: 0 }, 2, { x: 0, y: 0 }).zoom,
    ).toBe(MAX_ZOOM);
  });
});
