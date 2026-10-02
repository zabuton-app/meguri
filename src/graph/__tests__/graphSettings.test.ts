import { describe, expect, it } from "vitest";
import {
  defaultGraphSettings,
  eased,
  parseGraphSettings,
  physicsOf,
  uneased,
} from "../graphSettings";
import { DEFAULT_PHYSICS } from "../sim/physics";

describe("graph settings", () => {
  it("default to Obsidian's forces", () => {
    const p = physicsOf(defaultGraphSettings().forces);
    expect(p.centerStrength).toBeCloseTo(DEFAULT_PHYSICS.centerStrength, 12);
    expect(p.repelStrength).toBe(DEFAULT_PHYSICS.repelStrength);
    expect(p.linkStrength).toBeCloseTo(DEFAULT_PHYSICS.linkStrength, 12);
    expect(p.linkDistance).toBe(DEFAULT_PHYSICS.linkDistance);
  });

  it("ease strengths in from 0 to 1, and back", () => {
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
    expect(eased(0.5)).toBeLessThan(0.5);
    for (const s of [0, 0.05, 0.1, 0.7, 1])
      expect(eased(uneased(s))).toBeCloseTo(s, 12);
    expect(physicsOf({ center: 0, repel: 2, link: 0, distance: 30 })).toEqual({
      centerStrength: 0,
      repelStrength: 8,
      linkStrength: 0,
      linkDistance: 30,
    });
  });

  it("read back what was stored, clamped, with defaults for the rest", () => {
    const d = defaultGraphSettings();
    expect(parseGraphSettings(null)).toEqual(d);
    expect(parseGraphSettings("{")).toEqual(d);
    const got = parseGraphSettings(
      JSON.stringify({
        display: { nodeSize: 2, lineSize: 99, textFade: "x" },
        forces: { repel: -5, distance: 100 },
      }),
    );
    expect(got.display).toEqual({ ...d.display, nodeSize: 2, lineSize: 5 });
    expect(d.display.sizeBy).toBe("links");
    expect(
      parseGraphSettings(JSON.stringify({ display: { sizeBy: "plays" } }))
        .display.sizeBy,
    ).toBe("plays");
    expect(
      parseGraphSettings(JSON.stringify({ display: { sizeBy: "size" } }))
        .display.sizeBy,
    ).toBe("links");
    expect(got.forces).toEqual({ ...d.forces, repel: 0, distance: 100 });
  });
});
