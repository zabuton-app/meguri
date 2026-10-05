import { describe, expect, it } from "vitest";
import { formatDay } from "@shared/day";
import {
  buildWeeks,
  levelOf,
  LEVELS,
  monthLabels,
  rangeFor,
} from "@/heatmap/calendar";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const span = (r: { from: Date; to: Date }) => [
  formatDay(r.from),
  formatDay(r.to),
];

describe("rangeFor", () => {
  it("shows the 53 weeks ending today, from a Sunday", () => {
    // 2026-10-05 is a Monday.
    const range = rangeFor(null, new Date(2026, 9, 5, 15, 30));
    expect(span(range)).toEqual(["2025-10-05", "2026-10-05"]);
    expect(range.from.getDay()).toBe(0);
    expect(buildWeeks(range)).toHaveLength(53);
  });

  it("shows a whole past year", () => {
    expect(span(rangeFor(2024, day(2026, 10, 5)))).toEqual([
      "2024-01-01",
      "2024-12-31",
    ]);
  });

  it("cuts the current year at today", () => {
    expect(span(rangeFor(2026, day(2026, 10, 5)))).toEqual([
      "2026-01-01",
      "2026-10-05",
    ]);
  });
});

describe("buildWeeks", () => {
  it("pads the first and last week outside the range", () => {
    // 2026-01-01 is a Thursday, 2026-01-12 a Monday.
    const weeks = buildWeeks({ from: day(2026, 1, 1), to: day(2026, 1, 12) });
    expect(weeks).toEqual([
      [null, null, null, null, "2026-01-01", "2026-01-02", "2026-01-03"],
      [
        "2026-01-04",
        "2026-01-05",
        "2026-01-06",
        "2026-01-07",
        "2026-01-08",
        "2026-01-09",
        "2026-01-10",
      ],
      ["2026-01-11", "2026-01-12", null, null, null, null, null],
    ]);
  });

  it("covers every day of a leap year once", () => {
    const days = buildWeeks(rangeFor(2024, day(2026, 1, 1)))
      .flat()
      .filter((d) => d !== null);
    expect(days).toHaveLength(366);
    expect(new Set(days).size).toBe(366);
    expect(days[0]).toBe("2024-01-01");
    expect(days[days.length - 1]).toBe("2024-12-31");
  });

  it("keeps whole days across a daylight-saving change", () => {
    // Clocks change in late March and late October in many zones.
    const days = buildWeeks({ from: day(2026, 3, 1), to: day(2026, 3, 31) })
      .flat()
      .filter((d) => d !== null);
    expect(days).toHaveLength(31);
  });
});

describe("monthLabels", () => {
  it("names each month once, at the column it starts in", () => {
    const weeks = buildWeeks({ from: day(2026, 1, 1), to: day(2026, 3, 14) });
    const labels = monthLabels(weeks);
    expect(labels.filter((m) => m !== null)).toEqual([0, 1, 2]);
    expect(labels[0]).toBe(0);
    // 2026-02-01 is a Sunday: the fifth column (index 5) starts February.
    expect(labels.indexOf(1)).toBe(5);
  });

  it("leaves out a month that only starts in the last column", () => {
    // The last week runs 2026-03-29 … 04-01: April has no room for a name.
    const weeks = buildWeeks({ from: day(2026, 3, 1), to: day(2026, 4, 1) });
    expect(monthLabels(weeks).filter((m) => m !== null)).toEqual([2]);
  });
});

describe("levelOf", () => {
  it("keeps empty days apart from the lightest shade", () => {
    expect(levelOf(0, 10)).toBe(0);
    expect(levelOf(1, 1000)).toBe(1);
    expect(levelOf(0, 0)).toBe(0);
  });

  it("gives the busiest day the darkest shade and never passes it", () => {
    expect(levelOf(10, 10)).toBe(LEVELS - 1);
    expect(levelOf(50, 10)).toBe(LEVELS - 1);
  });

  it("rises with the count", () => {
    const levels = [1, 10, 30, 60, 100].map((c) => levelOf(c, 100));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBeGreaterThan(2);
  });
});
