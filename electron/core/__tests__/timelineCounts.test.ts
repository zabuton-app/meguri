// The timeline's per-day counts, and the list they cut into days: the two
// must agree, day by day.
import { describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { searchWorkspaces, type CoreTarget } from "../crossWorkspace.js";
import { buildTimelineCounts } from "../timelineCounts.js";
import { searchFiles, setFavorite, timelineCounts } from "../queries.js";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import type { TimelineAxis } from "../../../shared/ipc/timeline.js";
import { daySeconds, parseDay } from "../../../shared/day.js";

/** The first local midnight of a "YYYY-MM" month. */
function parseMonth(month: string): Date | null {
  return parseDay(`${month}-01`);
}

/** A month as Unix seconds, both ends included. */
function monthSeconds(start: Date): [number, number] {
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return [daySeconds(start)[0], daySeconds(last)[1]];
}
import type { SearchQuery } from "../types.js";
import { insertFile, newDb } from "./helpers.js";

function target(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

/** Unix seconds of a local wall-clock time, so the tests hold in any zone. */
function at(month: string, day = 15, hour = 12): number {
  const d = parseMonth(month);
  if (!d) throw new Error(`bad month ${month}`);
  d.setDate(day);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** The counts, gathered by month so the tests read in months. */
function counts(db: DB, axis: TimelineAxis, query: SearchQuery = {}) {
  const { days, undated } = timelineCounts(db, query, axis);
  const months: Record<string, number> = {};
  for (const [day, n] of days) {
    const month = day.slice(0, 7);
    months[month] = (months[month] ?? 0) + n;
  }
  return { months, undated };
}

function byDay(db: DB, axis: TimelineAxis, query: SearchQuery = {}) {
  const { days, undated } = timelineCounts(db, query, axis);
  return { days: Object.fromEntries(days), undated };
}

/** The list's rows of one month: the axis's own date range set to it. */
function listed(db: DB, axis: TimelineAxis, month: string): string[] {
  const [from, to] = monthSeconds(parseMonth(month)!);
  const range: SearchQuery =
    axis === "captured"
      ? { capturedFrom: from, capturedTo: to }
      : { btimeFrom: from, btimeTo: to };
  return searchFiles(db, { ...range, sort: "name" }).items.map(
    (f) => f.relPath,
  );
}

describe("timelineCounts", () => {
  it("counts files by the local month of their capture date", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.jpg", capturedAt: at("2026-10", 1) });
    insertFile(db, rootId, { relPath: "b.jpg", capturedAt: at("2026-10", 31) });
    insertFile(db, rootId, { relPath: "c.jpg", capturedAt: at("2026-08") });
    insertFile(db, rootId, { relPath: "d.jpg", capturedAt: at("2022-07") });
    // No capture date (most videos): in no month, whatever its other dates.
    insertFile(db, rootId, {
      relPath: "e.mp4",
      mtime: at("2026-09"),
      btime: at("2026-09"),
    });

    expect(counts(db, "captured")).toEqual({
      months: { "2026-10": 2, "2026-08": 1, "2022-07": 1 },
      undated: 1,
    });
    expect(listed(db, "captured", "2026-10")).toEqual(["a.jpg", "b.jpg"]);
    expect(listed(db, "captured", "2026-09")).toEqual([]);
  });

  it("counts by the birth time on the other axis", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, {
      relPath: "a.mp4",
      btime: at("2025-01"),
      capturedAt: at("2024-12"),
    });
    insertFile(db, rootId, { relPath: "b.mp4", btime: at("2025-01", 2) });
    insertFile(db, rootId, { relPath: "none.mp4", capturedAt: at("2025-01") });

    expect(counts(db, "btime")).toEqual({
      months: { "2025-01": 2 },
      undated: 1,
    });
    expect(listed(db, "btime", "2025-01")).toEqual(["a.mp4", "b.mp4"]);
  });

  it("puts the first and last second of a month in that month", () => {
    const { db, rootId } = newDb();
    const [from, to] = monthSeconds(parseMonth("2026-03")!);
    insertFile(db, rootId, { relPath: "first.jpg", capturedAt: from });
    insertFile(db, rootId, { relPath: "last.jpg", capturedAt: to });
    insertFile(db, rootId, { relPath: "before.jpg", capturedAt: from - 1 });
    insertFile(db, rootId, { relPath: "after.jpg", capturedAt: to + 1 });

    expect(counts(db, "captured").months).toEqual({
      "2026-02": 1,
      "2026-03": 2,
      "2026-04": 1,
    });
    expect(listed(db, "captured", "2026-03")).toEqual([
      "first.jpg",
      "last.jpg",
    ]);
  });

  it("counts only the files the query matches, its own date range included", () => {
    const { db, rootId } = newDb();
    const fav = insertFile(db, rootId, {
      relPath: "fav.jpg",
      kind: "image",
      capturedAt: at("2026-05"),
    });
    insertFile(db, rootId, {
      relPath: "plain.jpg",
      kind: "image",
      capturedAt: at("2026-05"),
    });
    insertFile(db, rootId, { relPath: "clip.mp4", capturedAt: at("2026-06") });
    insertFile(db, rootId, { relPath: "undated.mp4" });
    setFavorite(db, fav, true);

    expect(counts(db, "captured", { favorite: true })).toEqual({
      months: { "2026-05": 1 },
      undated: 0,
    });
    expect(counts(db, "captured", { kind: "video" })).toEqual({
      months: { "2026-06": 1 },
      undated: 1,
    });
    // Unlike the heatmap, the axis's own range narrows the months: the
    // timeline is the list that range gives.
    const [from, to] = monthSeconds(parseMonth("2026-06")!);
    expect(
      counts(db, "captured", { capturedFrom: from, capturedTo: to }),
    ).toEqual({ months: { "2026-06": 1 }, undated: 0 });
  });

  it("ignores paging and sorting", () => {
    const { db, rootId } = newDb();
    for (let i = 0; i < 5; i++)
      insertFile(db, rootId, {
        relPath: `f${i}.jpg`,
        capturedAt: at("2026-05", i + 1),
      });
    expect(
      counts(db, "captured", { limit: 2, cursor: 3, sort: "name" }).months,
    ).toEqual({ "2026-05": 5 });
  });

  it("leaves deleted files out", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.jpg", capturedAt: at("2026-05") });
    const gone = insertFile(db, rootId, {
      relPath: "gone.jpg",
      capturedAt: at("2026-05"),
    });
    const goneUndated = insertFile(db, rootId, { relPath: "gone.mp4" });
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id IN (?, ?)").run(
      gone,
      goneUndated,
    );
    expect(counts(db, "captured")).toEqual({
      months: { "2026-05": 1 },
      undated: 0,
    });
  });

  it("adds up to the length of the list", () => {
    const { db, rootId } = newDb();
    const months = ["2026-10", "2026-10", "2026-01", "2019-12", "2019-12"];
    months.forEach((m, i) =>
      insertFile(db, rootId, {
        relPath: `f${i}.jpg`,
        capturedAt: at(m, i + 1),
      }),
    );
    insertFile(db, rootId, { relPath: "n1.mp4" });
    insertFile(db, rootId, { relPath: "n2.mp4" });

    const c = timelineCounts(db, {}, "captured");
    const total = [...c.days.values()].reduce((a, b) => a + b, 0) + c.undated;
    expect(total).toBe(searchFiles(db, { limit: 500 }).items.length);
  });
});

describe("timelineCounts by day", () => {
  it("puts the first and last second of a day on that day", () => {
    const { db, rootId } = newDb();
    const [from, to] = daySeconds(parseDay("2026-03-10")!);
    insertFile(db, rootId, { relPath: "first.jpg", capturedAt: from });
    insertFile(db, rootId, { relPath: "last.jpg", capturedAt: to });
    insertFile(db, rootId, { relPath: "next.jpg", capturedAt: to + 1 });
    insertFile(db, rootId, { relPath: "none.mp4" });
    expect(byDay(db, "captured")).toEqual({
      days: { "2026-03-10": 2, "2026-03-11": 1 },
      undated: 1,
    });
  });
});

describe("buildTimelineCounts", () => {
  it("sums the workspaces month by month, newest first", () => {
    const a = newDb();
    const b = newDb();
    insertFile(a.db, a.rootId, {
      relPath: "a1.jpg",
      capturedAt: at("2026-10"),
    });
    insertFile(a.db, a.rootId, {
      relPath: "a2.jpg",
      capturedAt: at("2024-02"),
    });
    insertFile(a.db, a.rootId, { relPath: "a3.mp4" });
    insertFile(b.db, b.rootId, {
      relPath: "b1.jpg",
      capturedAt: at("2026-10"),
    });
    insertFile(b.db, b.rootId, {
      relPath: "b2.jpg",
      capturedAt: at("2025-06"),
    });
    insertFile(b.db, b.rootId, { relPath: "b3.mp4" });

    expect(
      buildTimelineCounts(
        [target("ws-a", a.db), target("ws-b", b.db)],
        {},
        { axis: "captured" },
      ),
    ).toEqual({
      days: [
        { day: "2026-10-15", count: 2 },
        { day: "2025-06-15", count: 1 },
        { day: "2024-02-15", count: 1 },
      ],
      undated: 2,
    });
  });

  it("counts only a collection's files", () => {
    const a = newDb();
    const b = newDb();
    const a1 = insertFile(a.db, a.rootId, {
      relPath: "a1.jpg",
      capturedAt: at("2026-10"),
    });
    insertFile(a.db, a.rootId, {
      relPath: "a2.jpg",
      capturedAt: at("2026-10"),
    });
    const b1 = insertFile(b.db, b.rootId, { relPath: "b1.mp4" });
    insertFile(b.db, b.rootId, {
      relPath: "b2.jpg",
      capturedAt: at("2025-06"),
    });

    expect(
      buildTimelineCounts(
        [target("ws-a", a.db), target("ws-b", b.db)],
        {},
        {
          axis: "captured",
          refs: [
            { workspaceId: "ws-a", fileId: a1 },
            { workspaceId: "ws-b", fileId: b1 },
          ],
        },
      ),
    ).toEqual({ days: [{ day: "2026-10-15", count: 1 }], undated: 1 });
  });

  it("is empty for no workspaces", () => {
    expect(buildTimelineCounts([], {}, { axis: "btime" })).toEqual({
      days: [],
      undated: 0,
    });
  });
});

// Jumping to a month reads the list from a cursor made of the month's last
// second and the count of files before it (see src/timeline/anchor.ts).
describe("a cursor at the head of a month", () => {
  function seed() {
    const a = newDb();
    const b = newDb();
    // Newest first: 2026-10 ×3, 2026-08 ×2, 2022-07 ×2, undated ×2.
    insertFile(a.db, a.rootId, {
      relPath: "o1.jpg",
      capturedAt: at("2026-10", 3),
    });
    insertFile(b.db, b.rootId, {
      relPath: "o2.jpg",
      capturedAt: at("2026-10", 2),
    });
    insertFile(a.db, a.rootId, {
      relPath: "o3.jpg",
      capturedAt: at("2026-10", 1),
    });
    const [, augEnd] = monthSeconds(parseMonth("2026-08")!);
    // On the month's very last second, in both workspaces: the tie the
    // cursor's empty workspace id keeps.
    insertFile(a.db, a.rootId, { relPath: "g1.jpg", capturedAt: augEnd });
    insertFile(b.db, b.rootId, { relPath: "g2.jpg", capturedAt: augEnd });
    insertFile(a.db, a.rootId, {
      relPath: "j1.jpg",
      capturedAt: at("2022-07", 9),
    });
    insertFile(b.db, b.rootId, {
      relPath: "j2.jpg",
      capturedAt: at("2022-07", 8),
    });
    insertFile(a.db, a.rootId, { relPath: "n1.mp4" });
    insertFile(b.db, b.rootId, { relPath: "n2.mp4" });
    return { a, b };
  }

  function from(
    cores: CoreTarget[],
    v: number | null,
    offset: number,
  ): { names: string[]; offset: number | undefined } {
    const res = searchWorkspaces(cores, {
      sort: "captured",
      sortDir: "desc",
      limit: 3,
      cursor: { offset, key: { v, ws: "", id: 0 } },
    });
    const next = res.nextCursor;
    return {
      names: res.items.map((f) => f.relPath),
      offset: typeof next === "object" && next ? next.offset : undefined,
    };
  }

  it("starts the page at the month's first row, across workspaces", () => {
    const { a, b } = seed();
    const cores = [target("ws-a", a.db), target("ws-b", b.db)];
    const [, augEnd] = monthSeconds(parseMonth("2026-08")!);
    expect(from(cores, augEnd, 3)).toEqual({
      names: ["g1.jpg", "g2.jpg", "j1.jpg"],
      offset: 6,
    });
    const [, julEnd] = monthSeconds(parseMonth("2022-07")!);
    expect(from(cores, julEnd, 5).names).toEqual([
      "j1.jpg",
      "j2.jpg",
      "n1.mp4",
    ]);
  });

  it("starts at the undated tail with a null value", () => {
    const { a, b } = seed();
    const cores = [target("ws-a", a.db), target("ws-b", b.db)];
    expect(from(cores, null, 7).names).toEqual(["n1.mp4", "n2.mp4"]);
  });

  it("does the same over one workspace", () => {
    const { a } = seed();
    const [, augEnd] = monthSeconds(parseMonth("2026-08")!);
    expect(from([target("ws-a", a.db)], augEnd, 2).names).toEqual([
      "g1.jpg",
      "j1.jpg",
      "n1.mp4",
    ]);
    expect(from([target("ws-a", a.db)], null, 4).names).toEqual(["n1.mp4"]);
  });
});

describe("timeline_counts input", () => {
  const schema = ChannelInputs.timeline_counts;

  it("takes a query and one of the axes", () => {
    expect(schema.safeParse({ query: {}, axis: "captured" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ query: {}, axis: "btime" }).success).toBe(true);
  });

  it("refuses an axis the timeline does not have", () => {
    expect(schema.safeParse({ query: {}, axis: "added" }).success).toBe(false);
    expect(schema.safeParse({ query: {} }).success).toBe(false);
  });
});
