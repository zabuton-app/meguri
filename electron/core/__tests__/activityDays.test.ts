// The heatmap's per-day counts, and the day condition the list
// reads a cell's files with: the two must agree, cell by cell.
import { describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import type { CoreTarget } from "../crossWorkspace.js";
import { buildActivityDays } from "../activityDays.js";
import { activityDays, searchFiles, setFavorite } from "../queries.js";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import {
  ACTIVITY_MAX_DAYS,
  ACTIVITY_RANGE_FIELDS,
  type ActivityMetric,
} from "../../../shared/ipc/activity.js";
import {
  addDays,
  daySeconds,
  formatDay,
  parseDay,
} from "../../../shared/day.js";
import type { SearchQuery } from "../types.js";
import { insertFile, newDb } from "./helpers.js";

function target(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

/** Unix seconds of a local wall-clock time, so the tests hold in any zone. */
function at(day: string, hour = 12, minute = 0): number {
  const d = parseDay(day);
  if (!d) throw new Error(`bad day ${day}`);
  d.setHours(hour, minute, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function play(db: DB, fileId: number, playedAt: number): void {
  db.prepare(
    `INSERT INTO play_history (meta_key, played_at, position, via)
     SELECT meta_key, ?, NULL, 'browser' FROM files WHERE id = ?`,
  ).run(playedAt, fileId);
}

function setAdded(db: DB, fileId: number, createdAt: number): void {
  db.prepare("UPDATE files SET created_at = ? WHERE id = ?").run(
    createdAt,
    fileId,
  );
}

/** The search's date range for one day of a metric: what picking that day on
 *  the heatmap sets. */
function dayRange(metric: ActivityMetric, date: string): SearchQuery {
  const [from, to] = ACTIVITY_RANGE_FIELDS[metric];
  const [start, end] = daySeconds(parseDay(date)!);
  return { [from]: start, [to]: end };
}

function listed(db: DB, metric: ActivityMetric, date: string): string[] {
  return searchFiles(db, {
    ...dayRange(metric, date),
    sort: "name",
  }).items.map((f) => f.relPath);
}

const FROM = "2026-03-01";
const TO = "2026-03-31";

describe("activityDays", () => {
  it("counts captured files by local day, leaving out files without a capture date", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, {
      relPath: "a.jpg",
      capturedAt: at("2026-03-10", 0, 0),
    });
    insertFile(db, rootId, {
      relPath: "b.jpg",
      capturedAt: at("2026-03-10", 23, 59),
    });
    // No capture date (most videos): on no day at all, whatever its mtime.
    insertFile(db, rootId, { relPath: "c.mp4", mtime: at("2026-03-11") });
    insertFile(db, rootId, {
      relPath: "d.jpg",
      capturedAt: at("2026-03-12"),
      mtime: at("2026-03-11"),
    });
    insertFile(db, rootId, {
      relPath: "out.jpg",
      capturedAt: at("2026-04-01"),
    });

    expect(
      Object.fromEntries(activityDays(db, {}, "captured", FROM, TO)),
    ).toEqual({ "2026-03-10": 2, "2026-03-12": 1 });
    expect(listed(db, "captured", "2026-03-10")).toEqual(["a.jpg", "b.jpg"]);
    expect(listed(db, "captured", "2026-03-11")).toEqual([]);
    expect(listed(db, "captured", "2026-03-12")).toEqual(["d.jpg"]);
  });

  it("counts created files by their birth time, leaving out files without one", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.mp4", btime: at("2026-03-07") });
    insertFile(db, rootId, { relPath: "b.mp4", btime: at("2026-03-07", 1) });
    // No birth time (some filesystems report none): on no day at all.
    insertFile(db, rootId, { relPath: "none.mp4", mtime: at("2026-03-07") });

    expect(
      Object.fromEntries(activityDays(db, {}, "created", FROM, TO)),
    ).toEqual({ "2026-03-07": 2 });
    expect(listed(db, "created", "2026-03-07")).toEqual(["a.mp4", "b.mp4"]);
  });

  it("puts the first and last second of a day on that day", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, {
      relPath: "first.jpg",
      capturedAt: at("2026-03-10", 0, 0),
    });
    insertFile(db, rootId, {
      relPath: "last.jpg",
      capturedAt: at("2026-03-11", 0, 0) - 1,
    });
    // The range's own edges: its first second, and the second after its last.
    insertFile(db, rootId, { relPath: "edge.jpg", capturedAt: at(FROM, 0, 0) });
    insertFile(db, rootId, {
      relPath: "past.jpg",
      capturedAt: at("2026-04-01", 0, 0),
    });

    expect(
      Object.fromEntries(activityDays(db, {}, "captured", FROM, TO)),
    ).toEqual({ "2026-03-01": 1, "2026-03-10": 2 });
  });

  it("returns nothing for a range that runs backwards", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.jpg", capturedAt: at("2026-03-10") });
    expect(activityDays(db, {}, "captured", TO, FROM).size).toBe(0);
  });

  it("counts added files by the day they entered the index", () => {
    const { db, rootId } = newDb();
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    setAdded(db, a, at("2026-03-05"));
    setAdded(db, b, at("2026-03-06"));

    expect(Object.fromEntries(activityDays(db, {}, "added", FROM, TO))).toEqual(
      { "2026-03-05": 1, "2026-03-06": 1 },
    );
    expect(listed(db, "added", "2026-03-06")).toEqual(["b.mp4"]);
  });

  it("counts a file once per day however often it was played", () => {
    const { db, rootId } = newDb();
    const a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "ha" });
    const b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "hb" });
    insertFile(db, rootId, { relPath: "never.mp4", contentHash: "hn" });
    play(db, a, at("2026-03-10", 9));
    play(db, a, at("2026-03-10", 21));
    play(db, a, at("2026-03-12"));
    play(db, b, at("2026-03-10"));

    expect(
      Object.fromEntries(activityDays(db, {}, "played", FROM, TO)),
    ).toEqual({ "2026-03-10": 2, "2026-03-12": 1 });
    expect(listed(db, "played", "2026-03-10")).toEqual(["a.mp4", "b.mp4"]);
    expect(listed(db, "played", "2026-03-12")).toEqual(["a.mp4"]);
  });

  it("counts every identical copy the list would show for a played day", () => {
    const { db, rootId } = newDb();
    const a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "same" });
    insertFile(db, rootId, { relPath: "copy.mp4", contentHash: "same" });
    play(db, a, at("2026-03-10"));

    const count = activityDays(db, {}, "played", FROM, TO).get("2026-03-10");
    expect(count).toBe(listed(db, "played", "2026-03-10").length);
    expect(count).toBe(2);
  });

  it("narrows by the search and leaves deleted files out", () => {
    const { db, rootId } = newDb();
    const fav = insertFile(db, rootId, {
      relPath: "fav.jpg",
      kind: "image",
      capturedAt: at("2026-03-10"),
    });
    insertFile(db, rootId, {
      relPath: "plain.mp4",
      capturedAt: at("2026-03-10"),
    });
    const gone = insertFile(db, rootId, {
      relPath: "gone.jpg",
      kind: "image",
      capturedAt: at("2026-03-10"),
    });
    setFavorite(db, fav, true);
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(gone);

    const count = (query: Parameters<typeof activityDays>[1]) =>
      activityDays(db, query, "captured", FROM, TO).get("2026-03-10");
    expect(count({})).toBe(2);
    expect(count({ favorite: true })).toBe(1);
    expect(count({ kind: "video" })).toBe(1);
    // Paging, a folder and the day picked (the metric's own date range)
    // belong to the list, not the counts.
    expect(
      count({
        limit: 1,
        cursor: 1,
        folder: { path: "elsewhere", recursive: true },
        ...dayRange("captured", "2026-03-11"),
      }),
    ).toBe(2);
    // Another metric's range is a condition like any other.
    expect(count(dayRange("added", "2020-01-01"))).toBeUndefined();
  });

  it("returns nothing for a range that is not made of days", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.jpg", capturedAt: at("2026-03-10") });
    expect(activityDays(db, {}, "captured", "nope", TO).size).toBe(0);
    expect(activityDays(db, {}, "captured", FROM, "2026-02-31").size).toBe(0);
  });
});

describe("buildActivityDays", () => {
  it("sums workspaces and returns the days oldest first", () => {
    const one = newDb();
    const two = newDb();
    insertFile(one.db, one.rootId, {
      relPath: "a.jpg",
      capturedAt: at("2026-03-12"),
    });
    insertFile(one.db, one.rootId, {
      relPath: "b.jpg",
      capturedAt: at("2026-03-10"),
    });
    insertFile(two.db, two.rootId, {
      relPath: "c.jpg",
      capturedAt: at("2026-03-10"),
    });

    expect(
      buildActivityDays(
        [target("w1", one.db), target("w2", two.db)],
        {},
        {
          metric: "captured",
          from: FROM,
          to: TO,
        },
      ),
    ).toEqual({
      days: [
        { date: "2026-03-10", count: 2 },
        { date: "2026-03-12", count: 1 },
      ],
    });
  });

  it("keeps to the given files, as a collection does", () => {
    const one = newDb();
    const two = newDb();
    const a = insertFile(one.db, one.rootId, {
      relPath: "a.jpg",
      capturedAt: at("2026-03-10"),
    });
    insertFile(one.db, one.rootId, {
      relPath: "b.jpg",
      capturedAt: at("2026-03-10"),
    });
    insertFile(two.db, two.rootId, {
      relPath: "c.jpg",
      capturedAt: at("2026-03-10"),
    });
    const cores = [target("w1", one.db), target("w2", two.db)];
    const opts = { metric: "captured" as const, from: FROM, to: TO };

    expect(
      buildActivityDays(
        cores,
        {},
        {
          ...opts,
          refs: [{ workspaceId: "w1", fileId: a }],
        },
      ),
    ).toEqual({ days: [{ date: "2026-03-10", count: 1 }] });
    expect(buildActivityDays(cores, {}, { ...opts, refs: [] })).toEqual({
      days: [],
    });
  });
});

describe("activity_days payload", () => {
  const base = { query: {}, metric: "played", from: FROM, to: TO };

  it("accepts a range of days", () => {
    expect(ChannelInputs.activity_days.safeParse(base).success).toBe(true);
    expect(
      ChannelInputs.activity_days.safeParse({ ...base, to: FROM }).success,
    ).toBe(true);
  });

  it.each([
    { ...base, metric: "liked" },
    { ...base, from: "2026-3-1" },
    { ...base, to: "2026-02-30" },
    { ...base, from: TO, to: FROM },
    { ...base, query: { limit: 0 } },
  ])("rejects the payload %#", (payload) => {
    expect(ChannelInputs.activity_days.safeParse(payload).success).toBe(false);
  });

  it("bounds the range", () => {
    const from = parseDay(FROM)!;
    const span = (days: number) =>
      ChannelInputs.activity_days.safeParse({
        ...base,
        to: formatDay(addDays(from, days - 1)),
      }).success;
    expect(span(ACTIVITY_MAX_DAYS)).toBe(true);
    expect(span(ACTIVITY_MAX_DAYS + 1)).toBe(false);
  });
});
