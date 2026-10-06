import { describe, expect, it } from "vitest";
import {
  buildLayout,
  rowAt,
  rowOfIndex,
  sectionOfIndex,
  sectionOfRow,
  stepIndex,
  UNDATED,
} from "@/timeline/layout";

// 3 columns:
//   row 0  2026-10-15 (5)   row 3  2026-08-15 (2)  row 5  undated (4)
//   row 1  [0 1 2]          row 4  [5 6]           row 6  [7 8 9]
//   row 2  [3 4]                                   row 7  [10]
const counts = {
  days: [
    { day: "2026-10-15", count: 5 },
    { day: "2026-08-15", count: 2 },
  ],
  undated: 4,
};
const layout = buildLayout(counts, 3);

describe("buildLayout", () => {
  it("gives every section a header row and its files packed to the columns", () => {
    expect(layout.sections).toEqual([
      { key: "2026-10-15", count: 5, start: 0, headerRow: 0, rows: 2 },
      { key: "2026-08-15", count: 2, start: 5, headerRow: 3, rows: 1 },
      { key: UNDATED, count: 4, start: 7, headerRow: 5, rows: 2 },
    ]);
    expect(layout.rowCount).toBe(8);
    expect(layout.total).toBe(11);
  });

  it("has no undated section when every file is dated", () => {
    const l = buildLayout({ days: counts.days, undated: 0 }, 3);
    expect(l.sections.map((s) => s.key)).toEqual(["2026-10-15", "2026-08-15"]);
  });

  it("is the undated section alone when no file is dated", () => {
    const l = buildLayout({ days: [], undated: 2 }, 4);
    expect(l.sections).toEqual([
      { key: UNDATED, count: 2, start: 0, headerRow: 0, rows: 1 },
    ]);
  });

  it("is empty for no files, or no counts yet", () => {
    for (const l of [
      buildLayout({ days: [], undated: 0 }, 3),
      buildLayout(undefined, 3),
    ]) {
      expect(l.sections).toEqual([]);
      expect(l.rowCount).toBe(0);
      expect(l.total).toBe(0);
    }
  });

  it("puts one file on each row in a single column", () => {
    const l = buildLayout(counts, 1);
    expect(l.sections.map((s) => s.rows)).toEqual([5, 2, 4]);
    expect(l.rowCount).toBe(14);
    // A column count not yet measured is one column.
    expect(buildLayout(counts, 0).rowCount).toBe(14);
  });
});

describe("rowAt", () => {
  it("tells a header from a row of files, and which files those are", () => {
    expect(rowAt(layout, 0)).toMatchObject({
      kind: "header",
      section: { key: "2026-10-15" },
    });
    expect(rowAt(layout, 1)).toMatchObject({
      kind: "cards",
      first: 0,
      length: 3,
    });
    expect(rowAt(layout, 2)).toMatchObject({
      kind: "cards",
      first: 3,
      length: 2,
    });
    expect(rowAt(layout, 3)).toMatchObject({
      kind: "header",
      section: { key: "2026-08-15" },
    });
    expect(rowAt(layout, 4)).toMatchObject({
      kind: "cards",
      first: 5,
      length: 2,
    });
    expect(rowAt(layout, 7)).toMatchObject({
      kind: "cards",
      section: { key: UNDATED },
      first: 10,
      length: 1,
    });
  });

  it("has nothing outside the rows", () => {
    expect(rowAt(layout, -1)).toBeNull();
    expect(rowAt(layout, 8)).toBeNull();
  });
});

describe("sections by row and by index", () => {
  it("finds the section a row belongs to", () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7].map((r) => sectionOfRow(layout, r)?.key),
    ).toEqual([
      "2026-10-15",
      "2026-10-15",
      "2026-10-15",
      "2026-08-15",
      "2026-08-15",
      UNDATED,
      UNDATED,
      UNDATED,
    ]);
    expect(sectionOfRow(layout, 8)).toBeNull();
  });

  it("finds the section and the row of a file", () => {
    expect(sectionOfIndex(layout, 4)?.key).toBe("2026-10-15");
    expect(sectionOfIndex(layout, 5)?.key).toBe("2026-08-15");
    expect(sectionOfIndex(layout, 10)?.key).toBe(UNDATED);
    expect(sectionOfIndex(layout, 11)).toBeNull();
    expect([0, 2, 3, 5, 7, 10].map((i) => rowOfIndex(layout, i))).toEqual([
      1, 1, 2, 4, 6, 7,
    ]);
    expect(rowOfIndex(layout, -1)).toBe(-1);
  });
});

describe("stepIndex", () => {
  it("walks the list left and right, across sections", () => {
    expect(stepIndex(layout, 4, "right")).toBe(5);
    expect(stepIndex(layout, 5, "left")).toBe(4);
    expect(stepIndex(layout, 0, "left")).toBe(0);
    expect(stepIndex(layout, 10, "right")).toBe(10);
  });

  it("keeps the column going down, into the next section", () => {
    expect(stepIndex(layout, 0, "down")).toBe(3);
    expect(stepIndex(layout, 3, "down")).toBe(5);
    expect(stepIndex(layout, 4, "down")).toBe(6);
    expect(stepIndex(layout, 6, "down")).toBe(8);
  });

  it("lands on a short row's last file when the column is past its end", () => {
    // Column 2 of row 1, over a row holding columns 0 and 1.
    expect(stepIndex(layout, 2, "down")).toBe(4);
    expect(stepIndex(layout, 9, "down")).toBe(10);
  });

  it("keeps the column going up, into the previous section's last row", () => {
    expect(stepIndex(layout, 8, "up")).toBe(6);
    expect(stepIndex(layout, 5, "up")).toBe(3);
    expect(stepIndex(layout, 6, "up")).toBe(4);
    expect(stepIndex(layout, 3, "up")).toBe(0);
    // Column 2 over a section whose last row stops at column 1.
    expect(stepIndex(layout, 9, "up")).toBe(6);
  });

  it("stays put at either end", () => {
    expect(stepIndex(layout, 1, "up")).toBe(1);
    expect(stepIndex(layout, 10, "down")).toBe(10);
    expect(stepIndex(buildLayout(undefined, 3), 0, "down")).toBe(-1);
  });
});
