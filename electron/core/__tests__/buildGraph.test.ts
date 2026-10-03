// The graph view's payload: the same files files_search would list (in the same
// order, capped), and the tag links among them, merged across workspaces.
import { describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import type { CoreTarget } from "../crossWorkspace.js";
import { buildGraph } from "../graph/buildGraph.js";
import { recordPlay, searchFiles, setFavorite, setRating } from "../queries.js";
import { addFileTag, addManualTag, syncFts, upsertTag } from "../tags.js";
import type { GraphPayload } from "../../../shared/ipc/graph.js";
import { MANUAL_SORT } from "../../../shared/sortDir.js";
import type { SearchQuery } from "../types.js";
import { insertFile, newDb } from "./helpers.js";

function target(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

/** The (workspace, rel_path) of every file, in payload order. */
function files(p: GraphPayload): string[] {
  return p.files.id.map(
    (_, i) => `${p.workspaces[p.files.ws[i]]}/${p.files.relPath[i]}`,
  );
}

/** Every tag edge as "rel_path→namespace:name", sorted. */
function tagEdges(p: GraphPayload): string[] {
  const set = p.edgeSets.find((s) => s.source === "tag");
  if (!set) return [];
  return set.a
    .map((a, i) => {
      const b = set.b[i];
      return `${p.files.relPath[a]}→${p.tags.namespace[b]}:${p.tags.name[b]}`;
    })
    .sort();
}

function seed(db: DB, rootId: number, names: string[]): number[] {
  return names.map((relPath, i) => {
    const id = insertFile(db, rootId, {
      relPath,
      kind: relPath.endsWith(".jpg") ? "image" : "video",
      contentHash: `h-${relPath}`,
      capturedAt: 1000 + i,
    });
    syncFts(db, id);
    return id;
  });
}

describe("buildGraph", () => {
  it("lists what files_search lists, in its order, for common filters", () => {
    const { db, rootId } = newDb();
    const ids = seed(db, rootId, [
      "beach.mp4",
      "beach2.jpg",
      "cat.mp4",
      "cat2.jpg",
      "dog.mp4",
    ]);
    addManualTag(db, ids[0], "sea");
    addManualTag(db, ids[1], "sea");
    setRating(db, ids[2], 4);
    setFavorite(db, ids[3], true);

    const queries: SearchQuery[] = [
      {},
      { q: "beach" },
      { tags: ["sea"] },
      { kind: "image" },
      { ratingMin: 3 },
      { favorite: true },
      { sort: "name", sortDir: "desc" },
      { sort: "captured", sortDir: "asc" },
    ];
    for (const query of queries) {
      const expected = searchFiles(db, { ...query, limit: 500 }).items.map(
        (r) => `w/${r.relPath}`,
      );
      const got = buildGraph([target("w", db)], query, { cap: 100 });
      expect(files(got), JSON.stringify(query)).toEqual(expected);
      expect(got.totalFiles).toBe(expected.length);
      expect(got.truncated).toBe(false);
    }
  });

  it("cuts at the cap in the query's order and says so", () => {
    const { db, rootId } = newDb();
    seed(db, rootId, ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]);
    const got = buildGraph(
      [target("w", db)],
      { sort: "name", sortDir: "asc" },
      { cap: 2 },
    );
    expect(files(got)).toEqual(["w/a.mp4", "w/b.mp4"]);
    expect(got.totalFiles).toBe(4);
    expect(got.truncated).toBe(true);
  });

  it("links each file to its tags once, whatever attached them", () => {
    const { db, rootId } = newDb();
    const [a, b] = seed(db, rootId, ["a.mp4", "b.jpg"]);
    const sea = addManualTag(db, a, "sea");
    // The same tag through a second source is still one link.
    addFileTag(db, a, sea, "ai", 0.9);
    addManualTag(db, b, "sea");
    addFileTag(db, a, upsertTag(db, "res", "4k"), "auto-meta", null);

    const got = buildGraph([target("w", db)], {}, { cap: 100 });
    expect(tagEdges(got)).toEqual(["a.mp4→:sea", "a.mp4→res:4k", "b.jpg→:sea"]);
    expect(got.tags.name.length).toBe(2);
  });

  it("leaves deleted files out", () => {
    const { db, rootId } = newDb();
    const [a] = seed(db, rootId, ["a.mp4", "b.mp4"]);
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(a);
    expect(files(buildGraph([target("w", db)], {}, { cap: 100 }))).toEqual([
      "w/b.mp4",
    ]);
  });

  it("merges same-named tags across workspaces and keeps the cross-workspace order", () => {
    const one = newDb();
    const two = newDb();
    const [a] = seed(one.db, one.rootId, ["a.mp4"]);
    const [b] = seed(two.db, two.rootId, ["b.mp4"]);
    addManualTag(one.db, a, "sea");
    addManualTag(two.db, b, "sea");

    const got = buildGraph(
      [target("w1", one.db), target("w2", two.db)],
      { sort: "name", sortDir: "desc" },
      { cap: 100 },
    );
    expect(files(got)).toEqual(["w2/b.mp4", "w1/a.mp4"]);
    expect(got.tags.name).toEqual(["sea"]);
    expect(tagEdges(got)).toEqual(["a.mp4→:sea", "b.mp4→:sea"]);
    expect(got.workspaces.sort()).toEqual(["w1", "w2"]);
  });

  it("restricts to a collection's refs, in their stored order when sorted by it", () => {
    const one = newDb();
    const two = newDb();
    const [a, b] = seed(one.db, one.rootId, ["a.mp4", "b.mp4"]);
    const [c] = seed(two.db, two.rootId, ["c.mp4"]);
    const refs = [
      { workspaceId: "w2", fileId: c },
      { workspaceId: "w1", fileId: b },
      { workspaceId: "w1", fileId: a },
    ];
    const cores = [target("w1", one.db), target("w2", two.db)];

    expect(
      files(
        buildGraph(
          cores,
          { sort: MANUAL_SORT },
          { cap: 100, refs, storedOrder: true },
        ),
      ),
    ).toEqual(["w2/c.mp4", "w1/b.mp4", "w1/a.mp4"]);

    const partial = buildGraph(cores, {}, { cap: 100, refs: refs.slice(0, 2) });
    expect(files(partial).sort()).toEqual(["w1/b.mp4", "w2/c.mp4"]);
    expect(partial.totalFiles).toBe(2);

    expect(buildGraph(cores, {}, { cap: 100, refs: [] }).files.id).toEqual([]);
  });

  it("draws identical copies inside one workspace as one node", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.mp4", contentHash: "same" });
    insertFile(db, rootId, { relPath: "copy/a.mp4", contentHash: "same" });
    const got = buildGraph(
      [target("w", db)],
      { sort: "name", sortDir: "asc" },
      { cap: 100 },
    );
    expect(files(got)).toEqual(["w/a.mp4"]);
  });

  it("carries the thumbnail flag and kind", () => {
    const { db, rootId } = newDb();
    const [a] = seed(db, rootId, ["a.mp4", "b.jpg"]);
    db.prepare(
      "UPDATE files SET thumb_status = 'done', thumb_path = 't.webp' WHERE id = ?",
    ).run(a);
    const got = buildGraph(
      [target("w", db)],
      { sort: "name", sortDir: "asc" },
      { cap: 100 },
    );
    expect(got.files.hasThumb).toEqual([true, false]);
    expect(got.files.kind).toEqual(["video", "image"]);
  });
});

describe("buildGraph play counts", () => {
  it("counts each file's plays, copies together, per workspace", () => {
    const one = newDb();
    const two = newDb();
    const [a] = seed(one.db, one.rootId, ["a.mp4", "b.jpg"]);
    const copy = insertFile(one.db, one.rootId, {
      relPath: "copy/a.mp4",
      contentHash: "h-a.mp4",
    });
    const [c] = seed(two.db, two.rootId, ["c.mp4"]);
    recordPlay(one.db, a, "browser", null);
    recordPlay(one.db, a, "external", null);
    recordPlay(one.db, copy, "browser", 12);
    recordPlay(two.db, c, "browser", null);
    const got = buildGraph(
      [target("w1", one.db), target("w2", two.db)],
      { sort: "name", sortDir: "asc" },
      { cap: 100 },
    );
    const plays = Object.fromEntries(
      got.files.relPath.map((p, i) => [p, got.files.plays[i]]),
    );
    expect(plays).toEqual({ "a.mp4": 3, "b.jpg": 0, "c.mp4": 1 });
  });
});

describe("buildGraph with identical copies", () => {
  it("does not let copies take places meant for other files", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a1.mp4", contentHash: "same" });
    insertFile(db, rootId, { relPath: "a2.mp4", contentHash: "same" });
    insertFile(db, rootId, { relPath: "a3.mp4", contentHash: "same" });
    insertFile(db, rootId, { relPath: "b.mp4", contentHash: "b" });
    insertFile(db, rootId, { relPath: "c.mp4", contentHash: "c" });
    const got = buildGraph(
      [target("w", db)],
      { sort: "name", sortDir: "asc" },
      { cap: 2 },
    );
    expect(files(got)).toEqual(["w/a1.mp4", "w/b.mp4"]);
    expect(got.totalFiles).toBe(3);
    expect(got.truncated).toBe(true);
  });
  it("lets the first copy in a collection's stored order stand for the rest", () => {
    const { db, rootId } = newDb();
    const a1 = insertFile(db, rootId, {
      relPath: "a1.mp4",
      contentHash: "same",
    });
    const a2 = insertFile(db, rootId, {
      relPath: "a2.mp4",
      contentHash: "same",
    });
    const b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "b" });
    const refs = [a2, b, a1].map((fileId) => ({ workspaceId: "w", fileId }));
    const got = buildGraph(
      [target("w", db)],
      { sort: MANUAL_SORT },
      { cap: 100, refs, storedOrder: true },
    );
    expect(files(got)).toEqual(["w/a2.mp4", "w/b.mp4"]);
    expect(got.totalFiles).toBe(2);
  });
});

/** Counts the file rows buildGraph reads from `db` (graphFiles' query). */
function countFileRowsRead(db: DB): () => number {
  let read = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    if (!sql.includes("AS metaKey")) return stmt;
    const iterate = stmt.iterate.bind(stmt);
    stmt.iterate = function* (...args: unknown[]) {
      for (const row of iterate(...args)) {
        read++;
        yield row;
      }
    } as typeof stmt.iterate;
    return stmt;
  }) as typeof db.prepare;
  return () => read;
}

describe("buildGraph reads no more rows than the graph draws", () => {
  it("stops reading a search once the cap is reached", () => {
    const { db, rootId } = newDb();
    seed(
      db,
      rootId,
      Array.from(
        { length: 300 },
        (_, i) => `f${String(i).padStart(3, "0")}.mp4`,
      ),
    );
    const read = countFileRowsRead(db);
    const got = buildGraph(
      [target("w", db)],
      { sort: "name", sortDir: "asc" },
      { cap: 10 },
    );
    expect(got.files.id).toHaveLength(10);
    expect(read()).toBe(10);
  });

  it("stops walking a collection's refs once the cap is reached", () => {
    const { db, rootId } = newDb();
    const ids = seed(
      db,
      rootId,
      Array.from(
        { length: 1200 },
        (_, i) => `f${String(i).padStart(4, "0")}.mp4`,
      ),
    );
    const refs = ids.map((fileId) => ({ workspaceId: "w", fileId }));
    const read = countFileRowsRead(db);
    const got = buildGraph(
      [target("w", db)],
      { sort: MANUAL_SORT },
      { cap: 3, refs, storedOrder: true },
    );
    expect(got.files.id).toHaveLength(3);
    // One chunk of refs, not the whole collection.
    expect(read()).toBeLessThan(ids.length / 2);
  });
});

describe("buildGraph over a large collection in its stored order", () => {
  const n = 1200;
  function bigCollection() {
    const { db, rootId } = newDb();
    const names = Array.from(
      { length: n },
      (_, i) => `f${String(i).padStart(4, "0")}.mp4`,
    );
    const ids = seed(db, rootId, names);
    // Stored newest first, so the stored order is not the id order.
    const refs = [...ids]
      .reverse()
      .map((fileId) => ({ workspaceId: "w", fileId }));
    return { db, ids, names, refs };
  }

  it("keeps the stored order across chunks and cuts at the cap", () => {
    const { db, names, refs } = bigCollection();
    const got = buildGraph(
      [target("w", db)],
      { sort: MANUAL_SORT },
      { cap: 700, refs, storedOrder: true },
    );
    expect(files(got)).toEqual(
      [...names]
        .reverse()
        .slice(0, 700)
        .map((name) => `w/${name}`),
    );
    expect(got.totalFiles).toBe(n);
    expect(got.truncated).toBe(true);
  });

  it("walks on past chunks a filter empties until the graph is full", () => {
    const { db, ids, names, refs } = bigCollection();
    // Only the oldest files match, and they are stored last.
    for (const id of ids.slice(0, 5)) setFavorite(db, id, true);
    const got = buildGraph(
      [target("w", db)],
      { sort: MANUAL_SORT, favorite: true },
      { cap: 3, refs, storedOrder: true },
    );
    expect(files(got)).toEqual(
      [names[4], names[3], names[2]].map((name) => `w/${name}`),
    );
    expect(got.totalFiles).toBe(5);
    expect(got.truncated).toBe(true);
  });
});
