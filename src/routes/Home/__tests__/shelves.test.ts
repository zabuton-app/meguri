import { describe, expect, it } from "vitest";
import {
  distinctPlayed,
  msUntilNextDay,
  picksDayKey,
} from "@/routes/Home/shelves";

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

describe("distinctPlayed", () => {
  const e = (workspaceId: string, id: number) => ({ workspaceId, id });

  it("keeps each file's newest play, in order", () => {
    expect(
      distinctPlayed([e("a", 1), e("a", 2), e("a", 1), e("b", 1)], 10),
    ).toEqual([e("a", 1), e("a", 2), e("b", 1)]);
  });

  it("stops at the limit", () => {
    expect(distinctPlayed([e("a", 1), e("a", 2), e("a", 3)], 2)).toEqual([
      e("a", 1),
      e("a", 2),
    ]);
  });
});
