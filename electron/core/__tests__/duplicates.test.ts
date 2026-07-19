// Duplicate detection: single-DB grouping and cross-workspace aggregation.
import { describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { duplicateFiles } from "../queries.js";
import { addManualTag } from "../tags.js";
import {
  duplicateFileRefs,
  listDuplicatesWorkspaces,
  searchCollection,
  type CoreTarget,
} from "../crossWorkspace.js";
import type { SearchQuery } from "../types.js";
import { insertFile, newDb } from "./helpers.js";

function coreTarget(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

function seeded(): { db: DB; rootId: number; target: CoreTarget } {
  const { db, rootId } = newDb();
  return { db, rootId, target: coreTarget("ws1", db) };
}

describe("duplicateFiles", () => {
  it("groups files sharing (content_hash, size)", () => {
    const { db, rootId } = seeded();
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h1", size: 10 });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h1", size: 10 });
    insertFile(db, rootId, { relPath: "c.mp4", contentHash: "h2", size: 20 });

    const rows = duplicateFiles(db);
    expect(rows.map((r) => r.relPath).sort()).toEqual(["a.mp4", "b.mp4"]);
    expect(rows.every((r) => r.contentHash === "h1")).toBe(true);
  });

  it("ignores files without a content hash", () => {
    const { db, rootId } = seeded();
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: null, size: 10 });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: null, size: 10 });

    expect(duplicateFiles(db)).toEqual([]);
  });

  it("treats same hash with different sizes as distinct", () => {
    const { db, rootId } = seeded();
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h1", size: 10 });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h1", size: 11 });

    expect(duplicateFiles(db)).toEqual([]);
  });

  it("excludes soft-deleted rows", () => {
    const { db, rootId } = seeded();
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h1", size: 10 });
    const gone = insertFile(db, rootId, {
      relPath: "b.mp4",
      contentHash: "h1",
      size: 10,
    });
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(gone);

    expect(duplicateFiles(db)).toEqual([]);
  });
});

describe("listDuplicatesWorkspaces", () => {
  it("returns groups sorted by reclaimable bytes descending", () => {
    const { db, rootId, target } = seeded();
    // h1: 2 copies of 10 bytes → 10 reclaimable; h2: 3 copies of 100 → 200.
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h1", size: 10 });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h1", size: 10 });
    insertFile(db, rootId, { relPath: "c.mp4", contentHash: "h2", size: 100 });
    insertFile(db, rootId, { relPath: "d.mp4", contentHash: "h2", size: 100 });
    insertFile(db, rootId, { relPath: "e.mp4", contentHash: "h2", size: 100 });

    const res = listDuplicatesWorkspaces([target]);
    expect(res.groups.map((g) => g.contentHash)).toEqual(["h2", "h1"]);
    expect(res.fileCount).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.groups[0].files.map((f) => f.relPath)).toEqual([
      "c.mp4",
      "d.mp4",
      "e.mp4",
    ]);
  });

  it("stamps workspaceId and attaches tags", () => {
    const { db, rootId, target } = seeded();
    const id = insertFile(db, rootId, {
      relPath: "a.mp4",
      contentHash: "h1",
      size: 10,
    });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h1", size: 10 });
    addManualTag(db, id, "keep");

    const res = listDuplicatesWorkspaces([target]);
    const files = res.groups[0].files;
    expect(files.every((f) => f.workspaceId === "ws1")).toBe(true);
    expect(files.find((f) => f.id === id)?.tags?.map((t) => t.name)).toEqual([
      "keep",
    ]);
  });

  it("finds duplicates that only exist across workspaces", () => {
    const a = newDb();
    const b = newDb();
    insertFile(a.db, a.rootId, { relPath: "x.mp4", contentHash: "h1", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "y.mp4", contentHash: "h1", size: 10 });
    // Unique within and across → never reported.
    insertFile(b.db, b.rootId, { relPath: "z.mp4", contentHash: "h9", size: 10 });

    const res = listDuplicatesWorkspaces([
      coreTarget("wsA", a.db),
      coreTarget("wsB", b.db),
    ]);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].files.map((f) => [f.workspaceId, f.relPath])).toEqual([
      ["wsA", "x.mp4"],
      ["wsB", "y.mp4"],
    ]);
  });

  it("merges intra-DB and cross-DB duplicates into one group", () => {
    const a = newDb();
    const b = newDb();
    insertFile(a.db, a.rootId, { relPath: "a1.mp4", contentHash: "h1", size: 10 });
    insertFile(a.db, a.rootId, { relPath: "a2.mp4", contentHash: "h1", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "b1.mp4", contentHash: "h1", size: 10 });

    const res = listDuplicatesWorkspaces([
      coreTarget("wsA", a.db),
      coreTarget("wsB", b.db),
    ]);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].files).toHaveLength(3);
    expect(res.fileCount).toBe(3);
  });

  it("keeps same hash with different sizes apart across workspaces", () => {
    const a = newDb();
    const b = newDb();
    insertFile(a.db, a.rootId, { relPath: "x.mp4", contentHash: "h1", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "y.mp4", contentHash: "h1", size: 11 });

    const res = listDuplicatesWorkspaces([
      coreTarget("wsA", a.db),
      coreTarget("wsB", b.db),
    ]);
    expect(res.groups).toEqual([]);
    expect(res.fileCount).toBe(0);
  });

  it("returns the same result shape for single and multi target sets", () => {
    const a = newDb();
    insertFile(a.db, a.rootId, { relPath: "a1.mp4", contentHash: "h1", size: 10 });
    insertFile(a.db, a.rootId, { relPath: "a2.mp4", contentHash: "h1", size: 10 });
    const single = listDuplicatesWorkspaces([coreTarget("wsA", a.db)]);

    const empty = newDb();
    const multi = listDuplicatesWorkspaces([
      coreTarget("wsA", a.db),
      coreTarget("wsB", empty.db),
    ]);
    expect(multi).toEqual(single);
  });

  it("returns empty for no targets", () => {
    expect(listDuplicatesWorkspaces([])).toEqual({
      groups: [],
      fileCount: 0,
      truncated: false,
    });
  });
});

describe("duplicateFileRefs", () => {
  it("returns refs of every duplicated file in a single workspace", () => {
    const { db, rootId, target } = seeded();
    const a = insertFile(db, rootId, {
      relPath: "a.mp4",
      contentHash: "h1",
      size: 10,
    });
    const b = insertFile(db, rootId, {
      relPath: "b.mp4",
      contentHash: "h1",
      size: 10,
    });
    insertFile(db, rootId, { relPath: "c.mp4", contentHash: "h2", size: 20 });

    const refs = duplicateFileRefs([target]);
    expect(refs.map((r) => r.fileId).sort()).toEqual([a, b].sort());
    expect(refs.every((r) => r.workspaceId === "ws1")).toBe(true);
  });

  it("includes cross-workspace duplicates and excludes size mismatches", () => {
    const a = newDb();
    const b = newDb();
    const idA = insertFile(a.db, a.rootId, {
      relPath: "x.mp4",
      contentHash: "h1",
      size: 10,
    });
    const idB = insertFile(b.db, b.rootId, {
      relPath: "y.mp4",
      contentHash: "h1",
      size: 10,
    });
    // Same hash, different size: not a duplicate of the pair above.
    insertFile(b.db, b.rootId, { relPath: "z.mp4", contentHash: "h1", size: 99 });

    const refs = duplicateFileRefs([
      coreTarget("wsA", a.db),
      coreTarget("wsB", b.db),
    ]);
    expect(refs).toEqual([
      { workspaceId: "wsA", fileId: idA },
      { workspaceId: "wsB", fileId: idB },
    ]);
  });

  it("intersects with collection refs when given", () => {
    const { db, rootId, target } = seeded();
    const a = insertFile(db, rootId, {
      relPath: "a.mp4",
      contentHash: "h1",
      size: 10,
    });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h1", size: 10 });

    const refs = duplicateFileRefs(
      [target],
      [
        { workspaceId: "ws1", fileId: a },
        { workspaceId: "ws1", fileId: 9999 },
      ],
    );
    expect(refs).toEqual([{ workspaceId: "ws1", fileId: a }]);
  });

  it("keeps copies adjacent with the hash sort, across workspaces", () => {
    const a = newDb();
    const b = newDb();
    // Default (id) sort would list all of wsA before wsB, splitting the pairs.
    insertFile(a.db, a.rootId, { relPath: "a1.mp4", contentHash: "h1", size: 10 });
    insertFile(a.db, a.rootId, { relPath: "a2.mp4", contentHash: "h2", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "b1.mp4", contentHash: "h1", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "b2.mp4", contentHash: "h2", size: 10 });

    const cores = [coreTarget("wsA", a.db), coreTarget("wsB", b.db)];
    const res = searchCollection(cores, duplicateFileRefs(cores), {
      sort: "hash",
    });
    expect(res.items.map((f) => f.relPath)).toEqual([
      "a1.mp4",
      "b1.mp4",
      "a2.mp4",
      "b2.mp4",
    ]);
  });

  it("keeps the hash sort stable across keyset pages", () => {
    const a = newDb();
    const b = newDb();
    for (let i = 0; i < 4; i++) {
      insertFile(a.db, a.rootId, {
        relPath: `a${i}.mp4`,
        contentHash: `h${i}`,
        size: 10,
      });
      insertFile(b.db, b.rootId, {
        relPath: `b${i}.mp4`,
        contentHash: `h${i}`,
        size: 10,
      });
    }
    const cores = [coreTarget("wsA", a.db), coreTarget("wsB", b.db)];
    const refs = duplicateFileRefs(cores);
    const all: string[] = [];
    let cursor: SearchQuery["cursor"];
    for (let guard = 0; guard < 10; guard++) {
      const page = searchCollection(cores, refs, {
        sort: "hash",
        limit: 3,
        cursor,
      });
      all.push(...page.items.map((f) => f.relPath));
      if (page.nextCursor == null) break;
      cursor = page.nextCursor;
    }
    expect(all).toEqual([
      "a0.mp4",
      "b0.mp4",
      "a1.mp4",
      "b1.mp4",
      "a2.mp4",
      "b2.mp4",
      "a3.mp4",
      "b3.mp4",
    ]);
  });

  it("feeds searchCollection as a duplicates-only search filter", () => {
    const a = newDb();
    const b = newDb();
    insertFile(a.db, a.rootId, { relPath: "dup-a.mp4", contentHash: "h1", size: 10 });
    insertFile(a.db, a.rootId, { relPath: "solo.mp4", contentHash: "h2", size: 10 });
    insertFile(b.db, b.rootId, { relPath: "dup-b.mp4", contentHash: "h1", size: 10 });

    const cores = [coreTarget("wsA", a.db), coreTarget("wsB", b.db)];
    const res = searchCollection(cores, duplicateFileRefs(cores), {});
    expect(res.items.map((f) => f.relPath).sort()).toEqual([
      "dup-a.mp4",
      "dup-b.mp4",
    ]);
    expect(res.nextCursor).toBeNull();
  });
});
