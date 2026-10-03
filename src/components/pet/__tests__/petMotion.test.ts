import { describe, expect, it } from "vitest";
import {
  clampToFloor,
  dragTo,
  isDrag,
  ratioFromX,
  stepFall,
  stepWalk,
  xFromRatio,
  type PetBody,
  type PetFloor,
} from "../petMotion";

const floor: PetFloor = { left: 100, right: 900, y: 600 };
const WIDTH = 72;
const size = { width: WIDTH, height: 60 };

describe("pet floor", () => {
  it("maps the saved ratio onto the floor and back", () => {
    expect(xFromRatio(floor, WIDTH, 0)).toBe(100);
    expect(xFromRatio(floor, WIDTH, 1)).toBe(900 - WIDTH);
    const x = xFromRatio(floor, WIDTH, 0.25);
    expect(ratioFromX(floor, WIDTH, x)).toBeCloseTo(0.25);
  });

  it("keeps the pet on the floor when the floor shrinks", () => {
    const narrow: PetFloor = { left: 100, right: 400, y: 600 };
    const x = xFromRatio(narrow, WIDTH, 0.9);
    expect(x).toBeGreaterThanOrEqual(narrow.left);
    expect(x + WIDTH).toBeLessThanOrEqual(narrow.right);
  });

  it("copes with a floor narrower than the pet", () => {
    const tiny: PetFloor = { left: 100, right: 120, y: 600 };
    expect(xFromRatio(tiny, WIDTH, 0.7)).toBe(100);
    expect(ratioFromX(tiny, WIDTH, 500)).toBe(0);
    expect(clampToFloor(tiny, WIDTH, 500)).toBe(100);
  });
});

describe("pet drag", () => {
  it("tells a drag from a click by how far the pointer moved", () => {
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(5, 0)).toBe(true);
  });

  it("confines a drag to the window and never goes below the floor", () => {
    expect(dragTo(-50, -50, size, 1000, floor)).toEqual({ x: 0, lift: 540 });
    expect(dragTo(5000, 5000, size, 1000, floor)).toEqual({
      x: 1000 - WIDTH,
      lift: 0,
    });
    expect(dragTo(300, 340, size, 1000, floor)).toEqual({ x: 300, lift: 200 });
  });
});

describe("pet fall", () => {
  it("accelerates downwards and lands on the floor", () => {
    let body: PetBody = { x: 300, lift: 200, vy: 0 };
    let landed = false;
    let frames = 0;
    let speed = 0;
    while (!landed && frames < 600) {
      const next = stepFall(body, 1 / 60, floor, WIDTH);
      if (!next.landed) expect(next.vy).toBeGreaterThan(speed);
      speed = next.vy;
      landed = next.landed;
      body = next;
      frames += 1;
    }
    expect(landed).toBe(true);
    expect(body).toMatchObject({ x: 300, lift: 0, vy: 0 });
  });

  it("drifts onto the floor when released beside it", () => {
    const next = stepFall({ x: 0, lift: 500, vy: 0 }, 1 / 60, floor, WIDTH);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThanOrEqual(floor.left);
    const landed = stepFall({ x: 0, lift: 1, vy: 4000 }, 1 / 60, floor, WIDTH);
    expect(landed).toMatchObject({ x: floor.left, lift: 0, landed: true });
  });
});

describe("pet walk", () => {
  it("moves in its direction, faster the larger it is drawn", () => {
    const small = stepWalk(300, 1, 2, 1, floor, WIDTH);
    const large = stepWalk(300, 1, 4, 1, floor, WIDTH);
    expect(small.x).toBeGreaterThan(300);
    expect(large.x - 300).toBeCloseTo((small.x - 300) * 2);
    expect(stepWalk(300, -1, 3, 1, floor, WIDTH).x).toBeLessThan(300);
    expect(small.hitEdge).toBe(false);
  });

  it("stops at the ends of the floor", () => {
    expect(stepWalk(101, -1, 3, 1, floor, WIDTH)).toEqual({
      x: 100,
      hitEdge: true,
    });
    expect(stepWalk(827, 1, 3, 1, floor, WIDTH)).toEqual({
      x: 828,
      hitEdge: true,
    });
  });
});
