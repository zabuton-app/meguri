// The name sort's key (nameKey.ts, #292).
import { describe, expect, it } from "vitest";
import { naturalNameKey } from "../nameKey.js";

const sorted = (paths: string[]) =>
  [...paths].sort((a, b) => {
    const ka = naturalNameKey(a);
    const kb = naturalNameKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

describe("naturalNameKey", () => {
  it("orders digit runs as numbers", () => {
    expect(sorted(["clip-10.mp4", "clip-9.mp4", "clip-100.mp4"])).toEqual([
      "clip-9.mp4",
      "clip-10.mp4",
      "clip-100.mp4",
    ]);
    expect(sorted(["Ep10", "Ep2", "Ep1"])).toEqual(["Ep1", "Ep2", "Ep10"]);
  });

  it("folds case", () => {
    expect(sorted(["beach.jpg", "Apple.jpg", "cat.jpg"])).toEqual([
      "Apple.jpg",
      "beach.jpg",
      "cat.jpg",
    ]);
  });

  it("keeps files grouped by folder", () => {
    expect(sorted(["b/1.jpg", "a10/1.jpg", "a2/9.jpg"])).toEqual([
      "a2/9.jpg",
      "a10/1.jpg",
      "b/1.jpg",
    ]);
  });

  it("gives leading zeros the same key, for the id to break the tie", () => {
    expect(naturalNameKey("Ep02")).toBe(naturalNameKey("Ep2"));
    expect(naturalNameKey("0")).toBe("110");
  });

  it("orders numbers of any length", () => {
    expect(sorted(["x99999999999999999999", "x100000000000000000000"])).toEqual(
      ["x99999999999999999999", "x100000000000000000000"],
    );
    // Where the length itself gains a digit.
    const nines = "9".repeat(99);
    const power = "1" + "0".repeat(99);
    expect(sorted([`x${power}`, `x${nines}`])).toEqual([
      `x${nines}`,
      `x${power}`,
    ]);
  });
});
