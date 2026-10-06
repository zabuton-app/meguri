import { describe, expect, it } from "vitest";
import { daySeconds, parseDay } from "@shared/day";
import { FILES_SEARCH_PAGE_SIZE as PAGE } from "@/lib/filesSearch";
import { anchorFor, sameAnchor } from "@/timeline/anchor";
import { buildLayout } from "@/timeline/layout";

// Sections (days) start at 0, 1000, 1250 and (undated) 4250.
const layout = buildLayout(
  {
    days: [
      { day: "2026-10-15", count: 1000 },
      { day: "2026-08-15", count: 250 },
      { day: "2022-07-15", count: 3000 },
    ],
    undated: 40,
  },
  5,
);
const lastSecond = (day: string) => daySeconds(parseDay(day)!)[1];

describe("anchorFor", () => {
  it("reads from the top while the view is near it", () => {
    expect(anchorFor(layout, 0)).toBeUndefined();
    expect(anchorFor(layout, PAGE / 2 - 1)).toBeUndefined();
  });

  it("seeks to a day's last second at the head of its section", () => {
    expect(anchorFor(layout, 1000)).toEqual({
      offset: 1000,
      key: { v: lastSecond("2026-08-15"), ws: "", id: 0 },
    });
    // A few rows in: still read from the head.
    expect(anchorFor(layout, 1250 + PAGE / 2 - 1)).toEqual({
      offset: 1250,
      key: { v: lastSecond("2022-07-15"), ws: "", id: 0 },
    });
  });

  it("seeks to the undated tail with a null value", () => {
    expect(anchorFor(layout, 4250)).toEqual({
      offset: 4250,
      key: { v: null, ws: "", id: 0 },
    });
  });

  it("falls back to a page-aligned offset deep inside a section", () => {
    expect(anchorFor(layout, 520)).toBe(500);
    expect(anchorFor(layout, 1250 + 1234)).toBe(2400);
    // Never a page that starts inside the rows above the one asked for's
    // section head by accident: the offset is the page holding the index.
    expect(anchorFor(layout, 1250 + PAGE / 2)).toBe(1300);
  });

  it("has no cursor for an index outside the list", () => {
    expect(anchorFor(layout, -1)).toBeUndefined();
    expect(anchorFor(layout, 99_999)).toBeUndefined();
  });
});

describe("sameAnchor", () => {
  it("compares cursors by value", () => {
    expect(sameAnchor(undefined, undefined)).toBe(true);
    expect(sameAnchor(500, 500)).toBe(true);
    expect(sameAnchor(500, 600)).toBe(false);
    expect(sameAnchor(anchorFor(layout, 1000), anchorFor(layout, 1010))).toBe(
      true,
    );
    expect(sameAnchor(anchorFor(layout, 1000), undefined)).toBe(false);
  });
});
