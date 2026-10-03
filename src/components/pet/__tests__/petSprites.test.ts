import { describe, expect, it } from "vitest";
import {
  PET_ANIMATIONS,
  PET_HEIGHT,
  PET_STATES,
  PET_SYMBOLS,
  PET_WIDTH,
} from "../petSprites";
import { frameToRects, frameToSvg, petRoleColor } from "../petRender";

describe("pet sprites", () => {
  const frames = PET_STATES.flatMap((state) =>
    PET_ANIMATIONS[state].frames.map((frame, i) => ({ state, i, frame })),
  );

  it("gives every state 2–4 frames", () => {
    for (const state of PET_STATES) {
      const n = PET_ANIMATIONS[state].frames.length;
      expect(n, state).toBeGreaterThanOrEqual(2);
      expect(n, state).toBeLessThanOrEqual(4);
    }
  });

  it.each(frames)("$state #$i is a full grid of known symbols", ({ frame }) => {
    expect(frame).toHaveLength(PET_HEIGHT);
    for (const row of frame) {
      expect(row).toHaveLength(PET_WIDTH);
      for (const ch of row) {
        expect(ch === "." || ch in PET_SYMBOLS, `symbol "${ch}"`).toBe(true);
      }
    }
  });

  it("keeps every grounded frame standing on the floor row", () => {
    const airborne = new Set(["held", "fall"]);
    for (const { state, frame } of frames) {
      if (airborne.has(state)) continue;
      expect(frame[PET_HEIGHT - 1], state).toMatch(/[^.]/);
    }
  });
});

describe("frameToRects", () => {
  it("merges horizontal runs of the same role and skips transparency", () => {
    expect(frameToRects([".OOB.", "FF..G"])).toEqual([
      { x: 1, y: 0, width: 2, role: "outline" },
      { x: 3, y: 0, width: 1, role: "body" },
      { x: 0, y: 1, width: 2, role: "face" },
      { x: 4, y: 1, width: 1, role: "tassel" },
    ]);
  });
});

describe("pet colors", () => {
  it("only lets the outline follow the theme", () => {
    expect(petRoleColor("outline", "light")).not.toBe(
      petRoleColor("outline", "dark"),
    );
    expect(petRoleColor("body", "light")).toBe(petRoleColor("body", "dark"));
  });

  it("renders crisp, scaled SVG", () => {
    const svg = frameToSvg(PET_ANIMATIONS.idle.frames[0], {
      scale: 3,
      appearance: "dark",
    });
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`width="${PET_WIDTH * 3}"`);
    expect(svg).toContain(petRoleColor("outline", "dark"));
  });
});
