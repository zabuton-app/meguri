// Regression tests for cross-workspace merge pagination (k-way merge).
import { afterEach, describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { recordAccess, searchFiles, setRating } from "../queries.js";
import {
  searchCollection,
  searchWorkspaces,
  type CoreTarget,
  type FileRef,
} from "../crossWorkspace.js";
import type {
  FileRow,
  SearchCursor,
  SearchQuery,
  SearchResult,
} from "../types.js";
import { insertFile, newDb } from "./helpers.js";

function coreTarget(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

/** Offset carried by a next cursor (object = keyset cursor, number = legacy). */
function cursorOffset(c: SearchResult["nextCursor"]): number | null {
  if (c == null) return null;
  return typeof c === "number" ? c : c.offset;
}

/** Reference implementation of the pre-k-way-merge strategy for equivalence checks. */
function searchWorkspacesNaive(
  cores: CoreTarget[],
  query: SearchQuery,
): SearchResult {
  const limit = Math.max(1, query.limit ?? 100);
  const c = query.cursor;
  const offset = Math.max(0, (typeof c === "object" ? c.offset : c) ?? 0);
  const perWs = offset + limit + 1;
  const all: FileRow[] = [];
  for (const { id, core } of cores) {
    const res = searchFiles(core.db, { ...query, cursor: 0, limit: perWs });
    for (const it of res.items) it.workspaceId = id;
    all.push(...res.items);
  }
  all.sort(comparatorFor(query.sort, query.sortDir));
  const page = all.slice(offset, offset + limit);
  const nextCursor = all.length > offset + limit ? offset + limit : null;
  return { items: page, nextCursor };
}

function comparatorFor(
  sort?: string,
  dir?: string,
): (a: FileRow, b: FileRow) => number {
  const direction = sortDir(sort, dir);
  switch (sort) {
    case "rating":
      return (a, b) => cmpNum(a.rating, b.rating, direction) || tiebreak(a, b);
    case "name":
      return (a, b) =>
        cmpStr(a.relPath, b.relPath, direction) || tiebreak(a, b);
    default:
      return (a, b) =>
        cmpStr(a.workspaceId, b.workspaceId) ||
        cmpNum(a.id, b.id, direction);
  }
}

function tiebreak(a: FileRow, b: FileRow): number {
  return cmpStr(a.workspaceId, b.workspaceId) || a.id - b.id;
}

function sortDir(sort?: string, dir?: string): "asc" | "desc" {
  if (dir === "asc" || dir === "desc") return dir;
  return sort === "rating" ? "desc" : "asc";
}

function cmpNum(a: number, b: number, dir: "asc" | "desc"): number {
  return dir === "asc" ? a - b : b - a;
}

function cmpStr(a: string, b: string, dir: "asc" | "desc" = "asc"): number {
  const result = a < b ? -1 : a > b ? 1 : 0;
  return dir === "asc" ? result : -result;
}

function seedWorkspace(
  wsId: string,
  count: number,
  prefix: string,
): { target: CoreTarget; db: DB } {
  const { db, rootId } = newDb();
  for (let i = 0; i < count; i++) {
    const id = insertFile(db, rootId, { relPath: `${prefix}${i}.mp4` });
    if (i % 5 === 0) setRating(db, id, i % 10);
  }
  return { target: coreTarget(wsId, db), db };
}

describe("searchWorkspaces", () => {
  const dbs: DB[] = [];
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  function track(db: DB): void {
    dbs.push(db);
  }

  it("returns empty results when no cores are provided", () => {
    expect(searchWorkspaces([], { limit: 10 })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("uses the single-workspace fast path without re-merge", () => {
    const ws = seedWorkspace("solo", 5, "solo/");
    track(ws.db);
    const query: SearchQuery = { limit: 2, cursor: 1, sort: "name" };

    const direct = searchFiles(ws.db, query);
    const got = searchWorkspaces([ws.target], query);

    expect(cursorOffset(got.nextCursor)).toBe(direct.nextCursor);
    expect(got.items.map((f) => [f.workspaceId, f.relPath])).toEqual(
      direct.items.map((f) => ["solo", f.relPath]),
    );
  });
});

describe("searchWorkspaces k-way merge", () => {
  const dbs: DB[] = [];
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  function track(db: DB): void {
    dbs.push(db);
  }

  it("matches naive merge for name sort across pages", () => {
    const a = seedWorkspace("aaa", 30, "a/");
    const b = seedWorkspace("bbb", 25, "b/");
    track(a.db);
    track(b.db);
    const cores = [a.target, b.target];

    for (const offset of [0, 10, 40, 50]) {
      const query: SearchQuery = { limit: 10, cursor: offset, sort: "name" };
      const got = searchWorkspaces(cores, query);
      const want = searchWorkspacesNaive(cores, query);
      expect(cursorOffset(got.nextCursor)).toBe(want.nextCursor);
      expect(got.items.map((f) => [f.workspaceId, f.relPath])).toEqual(
        want.items.map((f) => [f.workspaceId, f.relPath]),
      );
    }
  });

  it("matches naive merge for rating sort with a deep offset", () => {
    const a = seedWorkspace("ws-a", 60, "x/");
    const z = seedWorkspace("ws-z", 60, "y/");
    track(a.db);
    track(z.db);
    const cores = [a.target, z.target];
    const query: SearchQuery = { limit: 15, cursor: 55, sort: "rating" };
    const got = searchWorkspaces(cores, query);
    const want = searchWorkspacesNaive(cores, query);
    expect(cursorOffset(got.nextCursor)).toBe(want.nextCursor);
    expect(got.items.map((f) => [f.workspaceId, f.id])).toEqual(
      want.items.map((f) => [f.workspaceId, f.id]),
    );
  });
});

describe("keyset pagination equivalence", () => {
  const dbs: DB[] = [];
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  /** Shared rel_paths across workspaces force cross-ws sort-value ties; a
   *  captured_at mix (incl. NULLs) exercises the NULLs-last seek branches. */
  function seedTies(wsId: string, count: number): { target: CoreTarget; db: DB } {
    const { db, rootId } = newDb();
    for (let i = 0; i < count; i++) {
      const id = insertFile(db, rootId, {
        relPath: `shared/${i % 7}.mp4`.replace("/", `/${i}-`),
        capturedAt: i % 3 === 0 ? null : 1_700_000_000 + (i % 5),
      });
      if (i % 4 === 0) setRating(db, id, i % 6);
      // A last_accessed_at mix (NULLs + tied values) for the accessed sort;
      // recordAccess creates the file_meta row, then pin a deterministic value.
      if (i % 3 === 1) {
        recordAccess(db, id);
        db.prepare(
          "UPDATE file_meta SET last_accessed_at = ? WHERE meta_key = (SELECT meta_key FROM files WHERE id = ?)",
        ).run(1_600_000_000 + (i % 4), id);
      }
    }
    // A handful of genuinely identical rel_paths across both workspaces.
    for (let i = 0; i < 5; i++) {
      insertFile(db, rootId, { relPath: `tie/${i}.mp4`, capturedAt: null });
    }
    dbs.push(db);
    return { target: coreTarget(wsId, db), db };
  }

  it("walking keyed cursors matches one big page for every sort", () => {
    const a = seedTies("ws-a", 40);
    const b = seedTies("ws-b", 40);
    const cores = [a.target, b.target];
    const sorts: [string | undefined, "asc" | "desc"][] = [
      ["name", "asc"],
      ["name", "desc"],
      ["captured", "desc"],
      ["captured", "asc"],
      ["rating", "desc"],
      ["rating", "asc"],
      ["accessed", "desc"],
      ["accessed", "asc"],
      [undefined, "asc"],
      [undefined, "desc"],
    ];
    const keyFn = (f: FileRow) => `${f.workspaceId}:${f.id}`;
    for (const [sort, sortDir] of sorts) {
      const all = searchWorkspaces(cores, { sort, sortDir, limit: 500 }).items;
      const walked: FileRow[] = [];
      let cursor: SearchQuery["cursor"] = undefined;
      for (;;) {
        const page = searchWorkspaces(cores, { sort, sortDir, limit: 7, cursor });
        walked.push(...page.items);
        if (page.nextCursor == null) break;
        cursor = page.nextCursor;
      }
      expect(walked.map(keyFn), `sort=${sort ?? "id"} ${sortDir}`).toEqual(
        all.map(keyFn),
      );
    }
  });

  it("collection keyset walk matches one big collection page", () => {
    const a = seedTies("ws-a", 30);
    const b = seedTies("ws-b", 30);
    const cores = [a.target, b.target];
    // Restrict to every other file per workspace so the fileIds constraint is
    // exercised together with the seek batching (incl. stream refills).
    const refsFor = (t: { db: DB }, wsId: string): FileRef[] =>
      searchFiles(t.db, { limit: 500 })
        .items.filter((_, i) => i % 2 === 0)
        .map((f) => ({ workspaceId: wsId, fileId: f.id }));
    const refs = [...refsFor(a, "ws-a"), ...refsFor(b, "ws-b")];
    const keyFn = (f: FileRow) => `${f.workspaceId}:${f.id}`;

    const all = searchCollection(cores, refs, { sort: "name", limit: 500 });
    const walked: FileRow[] = [];
    let cursor: SearchQuery["cursor"] = undefined;
    for (;;) {
      const page = searchCollection(cores, refs, {
        sort: "name",
        limit: 5,
        cursor,
      });
      walked.push(...page.items);
      if (page.nextCursor == null) break;
      cursor = page.nextCursor;
    }
    expect(walked.map(keyFn)).toEqual(all.items.map(keyFn));
  });

  it("single-workspace keyed walk matches the offset walk", () => {
    const a = seedTies("solo", 35);
    const keyFn = (f: FileRow) => f.id;
    const all = searchWorkspaces([a.target], { sort: "captured", limit: 500 });
    const walked: FileRow[] = [];
    let cursor: SearchQuery["cursor"] = undefined;
    for (;;) {
      const page = searchWorkspaces([a.target], {
        sort: "captured",
        limit: 6,
        cursor,
      });
      walked.push(...page.items);
      if (page.nextCursor == null) break;
      cursor = page.nextCursor;
    }
    expect(walked.map(keyFn)).toEqual(all.items.map(keyFn));
  });
});

describe("searchCollection", () => {
  const dbs: DB[] = [];
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  it("returns empty results for empty refs", () => {
    const ws = seedWorkspace("solo", 3, "x/");
    dbs.push(ws.db);
    expect(
      searchCollection([ws.target], [], { limit: 10, sort: "name" }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("returns empty results when refs do not match any core", () => {
    const ws = seedWorkspace("solo", 3, "x/");
    dbs.push(ws.db);
    const refs: FileRef[] = searchFiles(ws.db, { limit: 100 }).items.map(
      (f) => ({ workspaceId: "missing-ws", fileId: f.id }),
    );
    expect(
      searchCollection([ws.target], refs, { limit: 10, sort: "name" }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("uses the single-workspace fast path for collection membership", () => {
    const ws = seedWorkspace("solo", 5, "solo/");
    dbs.push(ws.db);
    const refs: FileRef[] = searchFiles(ws.db, { limit: 100 }).items.map(
      (f) => ({ workspaceId: "solo", fileId: f.id }),
    );
    const query: SearchQuery = { limit: 2, cursor: 1, sort: "name" };

    const direct = searchFiles(ws.db, {
      ...query,
      fileIds: refs.map((r) => r.fileId),
    });
    const got = searchCollection([ws.target], refs, query);

    expect(cursorOffset(got.nextCursor)).toBe(direct.nextCursor);
    expect(got.items.map((f) => [f.workspaceId, f.relPath])).toEqual(
      direct.items.map((f) => ["solo", f.relPath]),
    );
  });
});

describe("searchCollection k-way merge", () => {
  const dbs: DB[] = [];
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  it("paginates collection membership across workspaces", () => {
    const a = seedWorkspace("col-a", 20, "a/");
    const b = seedWorkspace("col-b", 20, "b/");
    dbs.push(a.db, b.db);
    const cores = [a.target, b.target];
    const refs: FileRef[] = [
      ...searchFiles(a.db, { limit: 100 }).items.map((f) => ({
        workspaceId: "col-a",
        fileId: f.id,
      })),
      ...searchFiles(b.db, { limit: 100 }).items.map((f) => ({
        workspaceId: "col-b",
        fileId: f.id,
      })),
    ];

    const page0 = searchCollection(cores, refs, {
      limit: 10,
      cursor: 0,
      sort: "name",
    });
    const page1 = searchCollection(cores, refs, {
      limit: 10,
      cursor: 10,
      sort: "name",
    });
    expect(page0.items).toHaveLength(10);
    expect(page1.items).toHaveLength(10);
    expect(cursorOffset(page0.nextCursor)).toBe(10);

    const merged = [...page0.items, ...page1.items];
    const paths = merged.map((f) => f.relPath);
    expect(paths).toEqual(
      [...merged]
        .sort(
          (x, y) =>
            x.relPath.localeCompare(y.relPath) ||
            x.workspaceId.localeCompare(y.workspaceId) ||
            x.id - y.id,
        )
        .map((f) => f.relPath),
    );
    expect(new Set(merged.map((f) => `${f.workspaceId}:${f.id}`)).size).toBe(20);
  });

  it("walks cursor pages without overlap and ends with a null nextCursor", () => {
    const a = seedWorkspace("cur-a", 8, "a/");
    const b = seedWorkspace("cur-b", 7, "b/");
    dbs.push(a.db, b.db);
    const cores = [a.target, b.target];
    const refs: FileRef[] = [
      ...searchFiles(a.db, { limit: 100 }).items.map((f) => ({
        workspaceId: "cur-a",
        fileId: f.id,
      })),
      ...searchFiles(b.db, { limit: 100 }).items.map((f) => ({
        workspaceId: "cur-b",
        fileId: f.id,
      })),
    ];

    const seen = new Set<string>();
    let cursor: number | SearchCursor = 0;
    let pageCount = 0;
    const limit = 5;

    while (true) {
      const page = searchCollection(cores, refs, {
        limit,
        cursor,
        sort: "name",
      });
      pageCount++;
      for (const f of page.items) {
        const key = `${f.workspaceId}:${f.id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (page.nextCursor == null) {
        expect(page.items.length).toBeLessThanOrEqual(limit);
        break;
      }
      expect(page.items).toHaveLength(limit);
      cursor = page.nextCursor;
    }

    expect(seen.size).toBe(15);
    expect(pageCount).toBe(3);
  });
});
