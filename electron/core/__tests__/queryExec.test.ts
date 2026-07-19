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
import type {
  DuplicatesResult,
  FileRow,
  HistoryPage,
  SearchResult,
  WorkspaceStats,
} from "../types.js";
import { insertFile } from "./helpers.js";

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

  it("runs duplicates_list through the same target set", () => {
    insertFile(db, 1, {
      relPath: "dup-a.mp4",
      contentHash: "dup-hash",
      size: 123,
    });
    insertFile(db, 1, {
      relPath: "dup-b.mp4",
      contentHash: "dup-hash",
      size: 123,
    });

    const res = exec.run({
      kind: "duplicates",
      targets: target(),
    }) as DuplicatesResult;
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].files.map((f) => f.relPath).sort()).toEqual([
      "dup-a.mp4",
      "dup-b.mp4",
    ]);
    expect(res.fileCount).toBe(2);
  });

  it("rebuilds duplicates filter refs after explicit cache invalidation", () => {
    const a = insertFile(db, 1, {
      relPath: "dup-a.mp4",
      contentHash: "dup-hash",
      size: 123,
    });
    const b = insertFile(db, 1, {
      relPath: "dup-b.mp4",
      contentHash: "dup-hash",
      size: 123,
    });

    const first = exec.run({
      kind: "search",
      targets: target(),
      query: { duplicates: true, sort: "hash" },
    }) as SearchResult;
    expect(first.items.map((f) => f.id).sort((x, y) => x - y)).toEqual([a, b]);

    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(b);

    // Cached refs still include the now-non-duplicate file pair until
    // invalidateCaches() is called by the write path.
    const stale = exec.run({
      kind: "search",
      targets: target(),
      query: { duplicates: true, sort: "hash" },
    }) as SearchResult;
    expect(stale.items.map((f) => f.id)).toEqual([a]);

    exec.invalidateCaches();
    const fresh = exec.run({
      kind: "search",
      targets: target(),
      query: { duplicates: true, sort: "hash" },
    }) as SearchResult;
    expect(fresh.items).toEqual([]);
  });

  it("skips targets whose DB is gone, warning once, and reopens after closeWorkspace", () => {
    const warnings: string[] = [];
    const warnedExec = new QueryExecutor((m) => warnings.push(m));
    const missingTargets = [
      { id: "nope", dbPath: path.join(dir, "missing.sqlite") },
    ];
    const missing = warnedExec.run({
      kind: "search",
      targets: missingTargets,
      query: {},
    }) as SearchResult;
    expect(missing.items).toEqual([]);
    // Repeated queries don't spam: one warning per workspace until it's reset.
    warnedExec.run({ kind: "search", targets: missingTargets, query: {} });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("nope");
    warnedExec.closeAll();

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
