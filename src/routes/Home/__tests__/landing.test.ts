import { describe, expect, it } from "vitest";
import {
  isLandingEligible,
  msUntilNextDay,
  picksDayKey,
} from "@/routes/Home/landing";

describe("isLandingEligible", () => {
  it("shows over the plain library", () => {
    expect(isLandingEligible({}, false)).toBe(true);
  });

  it("ignores the sort: 'See all' changes it and the shelves stay", () => {
    expect(isLandingEligible({ sort: "btime", sortDir: "desc" }, false)).toBe(
      true,
    );
  });

  it("hides while a search or filter narrows the list", () => {
    expect(isLandingEligible({ q: "beach" }, false)).toBe(false);
    expect(isLandingEligible({ favorite: true }, false)).toBe(false);
    expect(isLandingEligible({ tags: ["4k"] }, false)).toBe(false);
    expect(isLandingEligible({ kind: "video" }, false)).toBe(false);
  });

  it("treats cleared fields as no filter", () => {
    expect(isLandingEligible({ q: "", tags: [], favorite: false }, false)).toBe(
      true,
    );
  });

  it("hides inside a collection (out of scope for the shelves)", () => {
    expect(isLandingEligible({}, true)).toBe(false);
  });
});

describe("picksDayKey", () => {
  it("keys on the local calendar day", () => {
    expect(picksDayKey(new Date(2026, 8, 15, 23, 59, 59))).toBe("2026-09-15");
    expect(picksDayKey(new Date(2026, 8, 16, 0, 0, 0))).toBe("2026-09-16");
    expect(picksDayKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("msUntilNextDay", () => {
  it("counts down to local midnight", () => {
    expect(msUntilNextDay(new Date(2026, 8, 15, 23, 59, 59))).toBe(1000);
    expect(msUntilNextDay(new Date(2026, 8, 15, 0, 0, 0))).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
