import { describe, expect, it } from "vitest";
import { formatDay } from "@shared/day";
import {
  formatMonth,
  monthSeconds,
  nextMonth,
  parseMonth,
} from "@/timeline/month";

describe("parseMonth", () => {
  it("reads a month as its first local midnight", () => {
    const d = parseMonth("2026-03");
    expect(d).toEqual(new Date(2026, 2, 1));
  });

  it("refuses anything that is not a calendar month", () => {
    for (const bad of [
      "",
      "2026",
      "2026-00",
      "2026-13",
      "2026-3",
      "26-03",
      "2026-03-01",
    ])
      expect(parseMonth(bad)).toBeNull();
  });
});

describe("formatMonth", () => {
  it("names the month a date falls in, as formatDay does", () => {
    for (const d of [
      new Date(2026, 0, 1),
      new Date(2026, 11, 31, 23, 59, 59),
      new Date(1999, 5, 15),
    ]) {
      expect(formatMonth(d)).toBe(formatDay(d).slice(0, 7));
      expect(parseMonth(formatMonth(d))).toEqual(
        new Date(d.getFullYear(), d.getMonth(), 1),
      );
    }
  });
});

describe("monthSeconds", () => {
  it("runs from the month's first second to its last, both included", () => {
    const [from, to] = monthSeconds(new Date(2026, 1, 14, 9));
    expect(from).toBe(Math.floor(new Date(2026, 1, 1).getTime() / 1000));
    expect(to).toBe(Math.floor(new Date(2026, 2, 1).getTime() / 1000) - 1);
  });

  it("rolls December over into the next year", () => {
    expect(nextMonth(new Date(2026, 11, 20))).toEqual(new Date(2027, 0, 1));
    const [, to] = monthSeconds(new Date(2026, 11, 1));
    expect(formatMonth(new Date(to * 1000))).toBe("2026-12");
    expect(formatMonth(new Date((to + 1) * 1000))).toBe("2027-01");
  });
});
