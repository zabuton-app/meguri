import { expect, it } from "vitest";
import { insertFile, newDb } from "./helpers.js";
import {
  searchFiles,
  randomFiles,
  setRating,
  graphFileCount,
  timelineCounts,
  activityDays,
} from "../queries.js";
import { SearchQuerySchema } from "../../../shared/ipc/schema.js";
import { formatDay } from "../../../shared/day.js";
import { syncFts } from "../tags.js";

it("intersects a bin and visitor filters consistently across list, graph, timeline and heatmap", () => {
  const { db, rootId } = newDb();
  try {
    const good = insertFile(db, rootId, {
      relPath: "harbour-sunset.mp4",
      contentHash: "good",
      width: 3840,
      height: 2160,
    });
    const lowRating = insertFile(db, rootId, {
      relPath: "harbour-dawn.mp4",
      contentHash: "low",
      width: 3840,
      height: 2160,
    });
    const wrongSize = insertFile(db, rootId, {
      relPath: "beach-sunset.mp4",
      contentHash: "hd",
      width: 1280,
      height: 720,
    });
    setRating(db, good, 5);
    setRating(db, lowRating, 2);
    setRating(db, wrongSize, 5);
    for (const id of [good, lowRating, wrongSize]) syncFts(db, id);
    const query = SearchQuerySchema.parse({
      ratingMin: 2,
      q: "harbour|beach",
      recent: { period: "today", basis: "added" },
      allOf: [
        {
          ratingMin: 4,
          q: "sunset|dawn",
          resolution: { preset: "uhd", match: "atLeast" },
        },
      ],
    });
    expect(searchFiles(db, query).items.map((file) => file.id)).toEqual([good]);
    expect(graphFileCount(db, query).rows).toBe(1);
    expect([...timelineCounts(db, query, "added").days.values()]).toEqual([1]);
    const day = formatDay(new Date());
    expect([...activityDays(db, query, "added", day, day).values()]).toEqual([
      1,
    ]);
  } finally {
    db.close();
  }
});

it("bounds flat bin clauses at the IPC boundary", () => {
  expect(
    SearchQuerySchema.safeParse({
      allOf: Array.from({ length: 33 }, () => ({ kind: "video" })),
    }).success,
  ).toBe(false);
});

it("never broadens a paused-filter view across list, random, graph, timeline and activity", () => {
  const { db, rootId } = newDb();
  try {
    insertFile(db, rootId, { relPath: "visible.mp4", contentHash: "paused" });
    const query = SearchQuerySchema.parse({
      matchNone: true,
      allOf: [{ kind: "video" }],
    });
    expect(searchFiles(db, query).items).toEqual([]);
    expect(randomFiles(db, query)).toEqual([]);
    expect(graphFileCount(db, query).rows).toBe(0);
    expect([...timelineCounts(db, query, "added").days.values()]).toEqual([]);
    const day = formatDay(new Date());
    expect([...activityDays(db, query, "added", day, day).values()]).toEqual(
      [],
    );
  } finally {
    db.close();
  }
});

it("returns no matches when a valid 720p filter is applied to a 4K bin", () => {
  const { db, rootId } = newDb();
  try {
    insertFile(db, rootId, {
      relPath: "4k.mp4",
      contentHash: "4k",
      width: 3840,
      height: 2160,
    });
    insertFile(db, rootId, {
      relPath: "720p.mp4",
      contentHash: "720p",
      width: 1280,
      height: 720,
    });
    const query = SearchQuerySchema.parse({
      kind: "video",
      resolution: { preset: "hd", match: "exact" },
      allOf: [
        { kind: "video", resolution: { preset: "uhd", match: "atLeast" } },
      ],
    });
    expect(searchFiles(db, query).items).toEqual([]);
    expect(randomFiles(db, query)).toEqual([]);
    expect(graphFileCount(db, query).rows).toBe(0);
  } finally {
    db.close();
  }
});
