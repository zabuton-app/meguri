import { describe, expect, it } from "vitest";
import {
  createKenBurnsSpec,
  kenBurnsKeyframes,
  maxOffsetPercent,
  MIN_SCALE,
  type KenBurnsSpec,
  type Rng,
} from "@/routes/Player/kenBurns";

/** Deterministic rng cycling through the given values. */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

/** A spread of rng behaviours, including both extremes. */
const RNGS: [string, Rng][] = [
  ["all zeros", () => 0],
  ["all near-one", () => 0.999999],
  ["midpoint", () => 0.5],
  ["ascending", seqRng([0.01, 0.2, 0.37, 0.51, 0.66, 0.83, 0.97])],
  ["descending", seqRng([0.97, 0.83, 0.66, 0.51, 0.37, 0.2, 0.01])],
];

function specs(durationMs = 5000): KenBurnsSpec[] {
  return RNGS.map(([, rng]) => createKenBurnsSpec(durationMs, rng));
}

describe("maxOffsetPercent", () => {
  it("is the overhang left by the scale, per side", () => {
    // At 1.2x the box is 20% wider, so 10% hangs over each edge.
    expect(maxOffsetPercent(1.2)).toBeCloseTo(10, 10);
    expect(maxOffsetPercent(1)).toBe(0);
  });
});

describe("createKenBurnsSpec", () => {
  it("never scales below the minimum at either end", () => {
    for (const spec of specs()) {
      expect(spec.fromScale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(spec.toScale).toBeGreaterThanOrEqual(MIN_SCALE);
    }
  });

  it("keeps every translation inside the overhang for its own scale", () => {
    // This is the invariant behind FR-026: no bare edge can appear mid-motion.
    for (const spec of specs()) {
      const fromLimit = maxOffsetPercent(spec.fromScale);
      const toLimit = maxOffsetPercent(spec.toScale);
      expect(Math.abs(spec.fromXY[0])).toBeLessThanOrEqual(fromLimit + 1e-9);
      expect(Math.abs(spec.fromXY[1])).toBeLessThanOrEqual(fromLimit + 1e-9);
      expect(Math.abs(spec.toXY[0])).toBeLessThanOrEqual(toLimit + 1e-9);
      expect(Math.abs(spec.toXY[1])).toBeLessThanOrEqual(toLimit + 1e-9);
    }
  });

  it("holds the invariant across many random draws", () => {
    for (let i = 0; i < 500; i++) {
      const spec = createKenBurnsSpec(5000);
      expect(spec.fromScale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(spec.toScale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(Math.abs(spec.fromXY[0])).toBeLessThanOrEqual(
        maxOffsetPercent(spec.fromScale) + 1e-9,
      );
      expect(Math.abs(spec.toXY[1])).toBeLessThanOrEqual(
        maxOffsetPercent(spec.toScale) + 1e-9,
      );
    }
  });

  it("always actually moves: the two ends differ in scale and position", () => {
    for (const spec of specs()) {
      expect(spec.fromScale).not.toBeCloseTo(spec.toScale, 6);
      expect(spec.fromXY).not.toEqual(spec.toXY);
    }
  });

  it("pans along a single direction (the two ends are opposite the origin)", () => {
    for (const spec of specs()) {
      // from is negative along the direction, to is positive: their dot product
      // is <= 0, which is what makes it one straight movement rather than a wander.
      const dot = spec.fromXY[0] * spec.toXY[0] + spec.fromXY[1] * spec.toXY[1];
      expect(dot).toBeLessThanOrEqual(1e-9);
    }
  });

  it("runs for exactly the requested duration", () => {
    // A shorter animation would leave the image frozen before it advances (SC-008).
    for (const ms of [1000, 5000, 60000]) {
      expect(createKenBurnsSpec(ms, () => 0.5).durationMs).toBe(ms);
    }
  });

  it("does not always pick the same direction", () => {
    const angles = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = createKenBurnsSpec(5000);
      angles.add(`${Math.sign(s.toXY[0])}:${Math.sign(s.toXY[1])}`);
    }
    expect(angles.size).toBeGreaterThan(1);
  });
});

describe("kenBurnsKeyframes", () => {
  it("emits translate before scale so the offset bound stays exact", () => {
    const frames = kenBurnsKeyframes(createKenBurnsSpec(5000, () => 0.5));
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(String(frame.transform)).toMatch(/^translate\(.+\) scale\(.+\)$/);
    }
  });
});
