import { afterEach, expect, it, vi } from "vitest";
import { newDb, insertFile } from "./helpers.js";
import { searchFiles } from "../queries.js";
import { recentFilesRange } from "../../../shared/recentFiles.js";

afterEach(() => vi.useRealTimers());

it("uses local calendar boundaries and elapsed rolling windows", () => {
  const now = new Date(2026, 10, 8, 15, 30);
  expect(recentFilesRange("today", now)[0]).toBe(
    new Date(2026, 10, 8).getTime() / 1000,
  );
  expect(recentFilesRange("thisWeek", now)[0]).toBe(
    new Date(2026, 10, 2).getTime() / 1000,
  );
  expect(
    recentFilesRange("lastHour", now)[1] - recentFilesRange("lastHour", now)[0],
  ).toBe(3600);
});

it("distinguishes first discovery from creation and recalculates a saved relative window", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 8, 15, 30));
  const { db, rootId } = newDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const added = insertFile(db, rootId, {
      relPath: "recently-found.mp4",
      btime: now - 100000,
    });
    const created = insertFile(db, rootId, {
      relPath: "recently-created.mp4",
      btime: now - 1000,
    });
    const unknown = insertFile(db, rootId, { relPath: "unknown.mp4" });
    db.prepare("UPDATE files SET created_at = ? WHERE id IN (?, ?)").run(
      now - 100000,
      created,
      unknown,
    );
    db.prepare("UPDATE files SET created_at = ? WHERE id = ?").run(
      now - 1000,
      added,
    );
    const recent = { period: "lastHour" as const, basis: "added" as const };
    expect(searchFiles(db, { recent }).items.map((f) => f.relPath)).toEqual([
      "recently-found.mp4",
    ]);
    expect(
      searchFiles(db, { recent: { ...recent, basis: "created" } }).items.map(
        (f) => f.relPath,
      ),
    ).toEqual(["recently-created.mp4"]);
    vi.setSystemTime(Date.now() + 3601000);
    expect(searchFiles(db, { recent }).items).toHaveLength(0);
  } finally {
    db.close();
  }
});
