import { describe, expect, it } from "vitest";
import { msUntilNextDay, picksDayKey } from "@/routes/Home/shelves";

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
