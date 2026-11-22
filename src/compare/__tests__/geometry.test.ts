import { describe, expect, it } from "vitest";
import { invert, overlapOf, spanOf } from "../geometry";

const a = { width: 100, height: 80 };

describe("spanOf", () => {
  it("is A's box when B sits inside it", () => {
    expect(
      spanOf(a, { width: 40, height: 30 }, { dx: 10, dy: 20, scale: 1 }),
    ).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it("grows to take in B where it sticks out on either side", () => {
    expect(spanOf(a, a, { dx: -15, dy: 9, scale: 1 })).toEqual({
      x: -15,
      y: 0,
      width: 115,
      height: 89,
    });
  });

  it("takes in B at the size it is drawn", () => {
    expect(
      spanOf(a, { width: 60, height: 50 }, { dx: 0, dy: 0, scale: 2 }),
    ).toEqual({ x: 0, y: 0, width: 120, height: 100 });
  });
});

describe("overlapOf", () => {
  it("is where B, at its scale, covers A", () => {
    expect(
      overlapOf(a, { width: 50, height: 50 }, { dx: 12, dy: -3, scale: 2 }),
    ).toEqual({ x: 12, y: 0, width: 88, height: 80 });
  });

  it("is null when B lies beside A", () => {
    expect(overlapOf(a, a, { dx: 100, dy: 0, scale: 1 })).toBeNull();
  });
});

describe("invert", () => {
  it("places A in B: the offset turned around and the scale inverted", () => {
    expect(invert({ dx: 12, dy: -3, scale: 2 })).toEqual({
      dx: -6,
      dy: 2,
      scale: 0.5,
    });
  });

  it("gives 0, not -0, for no offset", () => {
    expect(Object.is(invert({ dx: 0, dy: 0, scale: 1 }).dx, 0)).toBe(true);
  });
});
