import { describe, expect, it } from "vitest";
import { boundingSphere, fitDistance, pixelsPerUnit } from "../model/view3d";

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
