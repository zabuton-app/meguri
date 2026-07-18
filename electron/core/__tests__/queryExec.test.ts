// Tests for the read-only query executor shared by the query worker thread
// and the main-thread fallback. Uses file-backed temp DBs (a read-only
// connection needs an on-disk file; :memory: cannot be shared).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../db.js";
import { recordPlay, upsertScanRoot } from "../queries.js";
import { QueryExecutor } from "../queryExec.js";
import { insertFile } from "./helpers.js";
import type {
  FileRow,
  HistoryPage,
  SearchResult,
  WorkspaceStats,
} from "../types.js";

let dir: string;
let db: DB;
let dbPath: string;
let exec: QueryExecutor;
let fileIds: number[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "meguri-queryexec-"));
  dbPath = path.join(dir, "db.sqlite");
  db = openDb(dbPath);
  const rootId = upsertScanRoot(db, "/fake/root", "deadbeef");
  fileIds = [];
  for (let i = 0; i < 5; i++) {
    fileIds.push(insertFile(db, rootId, { relPath: `v${i}.mp4` }));
  }
  recordPlay(db, fileIds[0], "browser", null);
  exec = new QueryExecutor();
});

afterEach(() => {
  exec.closeAll();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const target = () => [{ id: "ws1", dbPath }];

describe("QueryExecutor", () => {
  it("runs searches through its own read-only connection", () => {
    const res = exec.run({
      kind: "search",
      targets: target(),
      query: { limit: 3, sort: "name" },
    }) as SearchResult;
    expect(res.items).toHaveLength(3);
    expect(res.items[0].workspaceId).toBe("ws1");
    expect(res.nextCursor).not.toBeNull();
  });

  it("sees rows committed by the writer after the reader was opened", () => {
    // Open the read-only handle first…
    exec.run({ kind: "stats", targets: target() });
    // …then commit a new row on the writer connection.
    insertFile(db, 1, { relPath: "later.mp4" });
    const stats = exec.run({
      kind: "stats",
      targets: target(),
    }) as WorkspaceStats;
    expect(stats.fileCount).toBe(6);
  });

  it("runs random / history / collection-scoped queries", () => {
    const random = exec.run({
      kind: "random",
      targets: target(),
      query: { limit: 2 },
    }) as FileRow[];
    expect(random).toHaveLength(2);

    const history = exec.run({
      kind: "history",
      targets: target(),
      query: {},
    }) as HistoryPage;
    expect(history.items).toHaveLength(1);
    expect(history.items[0].id).toBe(fileIds[0]);

    const scoped = exec.run({
      kind: "search",
      targets: target(),
      query: { limit: 10 },
      refs: [{ workspaceId: "ws1", fileId: fileIds[1] }],
    }) as SearchResult;
    expect(scoped.items.map((f) => f.id)).toEqual([fileIds[1]]);
  });

  it("skips targets whose DB is gone and reopens after closeWorkspace", () => {
    const missing = exec.run({
      kind: "search",
      targets: [{ id: "nope", dbPath: path.join(dir, "missing.sqlite") }],
      query: {},
    }) as SearchResult;
    expect(missing.items).toEqual([]);

    // Close and query again: the handle is reopened lazily from the path.
    exec.run({ kind: "stats", targets: target() });
    exec.closeWorkspace("ws1");
    const stats = exec.run({
      kind: "stats",
      targets: target(),
    }) as WorkspaceStats;
    expect(stats.fileCount).toBe(5);
  });
});
