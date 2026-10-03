import { describe, expect, it } from "vitest";
import { coverRect, ellipsizeMiddle } from "@/lib/fileDragImage";

describe("coverRect", () => {
  it("crops the sides of a source wider than the box", () => {
    expect(coverRect(400, 100, 160, 90)).toEqual({
      x: (400 - 1600 / 9) / 2,
      y: 0,
      width: 1600 / 9,
      height: 100,
    });
  });

  it("crops the top and bottom of a portrait source", () => {
    const rect = coverRect(90, 160, 160, 90);
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(90);
    expect(rect.height).toBeCloseTo(50.625);
    expect(rect.y).toBeCloseTo((160 - 50.625) / 2);
  });

  it("takes the whole of a source with the box's own shape", () => {
    expect(coverRect(320, 180, 160, 90)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
  });
});

describe("ellipsizeMiddle", () => {
  // One unit per character keeps the widths easy to read.
  const measure = (s: string) => [...s].length;

  it("leaves a name that fits alone", () => {
    expect(ellipsizeMiddle("clip.mp4", 20, measure)).toBe("clip.mp4");
  });

  it("drops the middle, keeping the start and the extension", () => {
    const out = ellipsizeMiddle(
      "holiday-in-the-mountains-2024.mp4",
      15,
      measure,
    );
    expect(measure(out)).toBeLessThanOrEqual(15);
    expect(out.startsWith("holiday")).toBe(true);
    expect(out.endsWith(".mp4")).toBe(true);
    expect(out).toContain("…");
  });

  it("does not split a surrogate pair", () => {
    const out = ellipsizeMiddle("🎬🎬🎬🎬🎬🎬🎬🎬.mp4", 7, measure);
    expect(out).toBe("🎬🎬🎬…mp4");
  });

  it("gives up gracefully when nothing fits", () => {
    expect(ellipsizeMiddle("abcdef", 1, measure)).toBe("…");
  });
});
