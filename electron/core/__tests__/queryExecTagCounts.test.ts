// The query executor keeps each workspace's tag counts until another
// connection commits to that workspace or the library (Issue 364). A separate
// file from queryExec.test.ts because counting listTags calls needs a module
// mock, which applies to the whole file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";
import { QueryExecutor } from "../queryExec.js";
import { addManualTag } from "../tags.js";
import type { TagList } from "../types.js";
import { insertFile } from "./helpers.js";

const counted = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../tagAdmin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tagAdmin.js")>();
  return {
    ...actual,
    listTags: (db: DB) => {
      counted.calls++;
      return actual.listTags(db);
    },
  };
});

let dir: string;
let db: DB;
let dbPath: string;
let libraryPath: string;
let exec: QueryExecutor;
let fileIds: number[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "meguri-tagcounts-"));
  dbPath = path.join(dir, "db.sqlite");
  libraryPath = path.join(dir, "library.sqlite");
  db = openDb(dbPath, libraryPath);
  const rootId = upsertScanRoot(db, "/fake/root", "deadbeef");
  fileIds = [];
  for (let i = 0; i < 3; i++) {
    fileIds.push(
      insertFile(db, rootId, { relPath: `v${i}.mp4`, contentHash: `h${i}` }),
    );
  }
  addManualTag(db, fileIds[0], "trip");
  addManualTag(db, fileIds[1], "trip");
  exec = new QueryExecutor();
  counted.calls = 0;
});

afterEach(() => {
  exec.closeAll();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const tagsList = () =>
  exec.run({
    kind: "tagsList",
    targets: [{ id: "ws1", dbPath, libraryPath }],
  }) as TagList;

const countOf = (list: TagList, name: string) =>
  list.tags.find((t) => t.name === name)?.fileCount;

describe("QueryExecutor tag counts", () => {
  it("counts once while nothing is committed", () => {
    const first = tagsList();
    const second = tagsList();
    expect(countOf(first, "trip")).toBe(2);
    expect(second).toEqual(first);
    expect(counted.calls).toBe(1);
  });

  it("counts again after the writer commits to the library", () => {
    expect(countOf(tagsList(), "trip")).toBe(2);
    addManualTag(db, fileIds[2], "trip");
    expect(countOf(tagsList(), "trip")).toBe(3);
    expect(counted.calls).toBe(2);
  });

  it("counts again after the writer commits to the workspace database", () => {
    expect(countOf(tagsList(), "trip")).toBe(2);
    // Deleting a file lives in the workspace database; the tag rows in the
    // library are untouched, yet the count of alive files drops.
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(fileIds[0]);
    expect(countOf(tagsList(), "trip")).toBe(1);
    expect(counted.calls).toBe(2);
  });

  it("counts again on a reopened connection", () => {
    tagsList();
    exec.closeWorkspace("ws1");
    tagsList();
    expect(counted.calls).toBe(2);
  });
});
