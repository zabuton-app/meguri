import { describe, expect, it } from "vitest";
import {
  boundingSphere,
  fitDistance,
  labelInView,
  pixelsPerUnit,
} from "../model/view3d";

describe("pixelsPerUnit", () => {
  it("is half the viewport height over tan(fov / 2) · depth", () => {
    expect(pixelsPerUnit(1, 90, 1000)).toBeCloseTo(500, 9);
    expect(pixelsPerUnit(2, 90, 1000)).toBeCloseTo(250, 9);
    expect(pixelsPerUnit(0, 50, 1000)).toBe(Infinity);
  });
});

describe("fitDistance", () => {
  it("backs off until the sphere fits the narrower angle", () => {
    const tall = fitDistance(100, 90, 2, 1);
    expect(tall).toBeCloseTo(100 / Math.sin(Math.PI / 4), 9);
    // A narrow viewport: the horizontal angle is the smaller one.
    expect(fitDistance(100, 90, 0.5, 1)).toBeGreaterThan(tall);
  });
});

describe("boundingSphere", () => {
  it("centres on the box and reaches the farthest point", () => {
    expect(boundingSphere([0, 0, 0, 2, 0, 0, 0, 4, 0])).toEqual({
      center: [1, 2, 0],
      radius: Math.hypot(1, 2),
    });
    expect(boundingSphere([])).toBeNull();
  });
});

describe("labelInView", () => {
  // A 20 px node, a label 100 px to either side reaching 30 px below it, in a
  // 800 × 600 viewport.
  const at = (x: number, y: number) => labelInView(x, y, 20, 100, 30, 800, 600);

  it("keeps a node whose label reaches in from the side", () => {
    expect(at(-90, 300)).toBe(true);
    expect(at(890, 300)).toBe(true);
    expect(at(-110, 300)).toBe(false);
    expect(at(910, 300)).toBe(false);
  });

  it("keeps a node above the top whose label hangs into view", () => {
    expect(at(400, -45)).toBe(true);
    expect(at(400, -55)).toBe(false);
  });

  it("drops a node below the bottom, since its label hangs further down", () => {
    expect(at(400, 615)).toBe(true);
    expect(at(400, 625)).toBe(false);
  });

  it("uses the node's own size when it is wider than the label", () => {
    expect(labelInView(-15, 300, 20, 5, 30, 800, 600)).toBe(true);
    expect(labelInView(-25, 300, 20, 5, 30, 800, 600)).toBe(false);
  });
});
