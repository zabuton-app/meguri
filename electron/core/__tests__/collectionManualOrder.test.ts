// The "manual" sort: a collection's own item order, which lives in config.json
// rather than in any SQL column. Covers both halves — persisting the order
// (Workspaces.reorderCollectionItems) and reading it back (searchCollectionManual).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import {
  searchCollection,
  searchCollectionManual,
  type CoreTarget,
  type FileRef,
} from "../crossWorkspace.js";
import type { SearchQuery, SearchResult } from "../types.js";
import { insertFile, newDb } from "./helpers.js";

// workspaces.ts reads/writes <userData>/config.json; point it at a throwaway dir.
let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");
const { WATCH_LATER_ID } = await import("../../../shared/workspaceIds.js");

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-manualorder-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

function coreTarget(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

/** A workspace holding `count` files named 001.mp4, 002.mp4, ... */
function seedWorkspace(
  count: number,
  seed?: (i: number) => Partial<{ kind: "video" | "image"; rating: number }>,
): { db: DB; ids: number[] } {
  const { db, rootId } = newDb();
  const ids: number[] = [];
  for (let i = 1; i <= count; i++) {
    const extra = seed?.(i) ?? {};
    const id = insertFile(db, rootId, {
      relPath: `${String(i).padStart(3, "0")}.${extra.kind === "image" ? "jpg" : "mp4"}`,
      kind: extra.kind ?? "video",
    });
    if (extra.rating != null) {
      db.prepare(
        `INSERT INTO file_meta (meta_key, rating) VALUES ((SELECT meta_key FROM files WHERE id = ?), ?)
         ON CONFLICT(meta_key) DO UPDATE SET rating = excluded.rating`,
      ).run(id, extra.rating);
    }
    ids.push(id);
  }
  return { db, ids };
}

function refsOf(wsId: string, ids: number[]): FileRef[] {
  return ids.map((fileId) => ({ workspaceId: wsId, fileId }));
}

function pathsOf(res: SearchResult): string[] {
  return res.items.map((i) => i.relPath);
}

/** Page through the manual sort, collecting every row in order. */
function pageAll(
  cores: CoreTarget[],
  refs: FileRef[],
  query: SearchQuery,
): string[] {
  const out: string[] = [];
  let cursor: SearchResult["nextCursor"] = null;
  let guard = 0;
  do {
    const res: SearchResult = searchCollectionManual(cores, refs, {
      ...query,
      cursor: cursor ?? undefined,
    });
    out.push(...pathsOf(res));
    cursor = res.nextCursor;
  } while (cursor != null && guard++ < 100);
  return out;
}

describe("searchCollectionManual", () => {
  it("returns rows in the refs order, not the DB's", () => {
    const { db, ids } = seedWorkspace(5);
    const cores = [coreTarget("ws1", db)];
    // Deliberately not ascending by id.
    const order = [ids[3], ids[0], ids[4], ids[1], ids[2]];
    const res = searchCollectionManual(cores, refsOf("ws1", order), {});
    expect(pathsOf(res)).toEqual([
      "004.mp4",
      "001.mp4",
      "005.mp4",
      "002.mp4",
      "003.mp4",
    ]);
  });

  it("keeps the order across pages", () => {
    const { db, ids } = seedWorkspace(10);
    const cores = [coreTarget("ws1", db)];
    const order = [...ids].reverse();
    expect(pageAll(cores, refsOf("ws1", order), { limit: 3 })).toEqual([
      "010.mp4",
      "009.mp4",
      "008.mp4",
      "007.mp4",
      "006.mp4",
      "005.mp4",
      "004.mp4",
      "003.mp4",
      "002.mp4",
      "001.mp4",
    ]);
  });

  it("reports no next cursor once the refs run out", () => {
    const { db, ids } = seedWorkspace(3);
    const cores = [coreTarget("ws1", db)];
    const res = searchCollectionManual(cores, refsOf("ws1", ids), {
      limit: 10,
    });
    expect(res.nextCursor).toBeNull();
    expect(res.items).toHaveLength(3);
  });

  it("interleaves workspaces exactly as the refs say", () => {
    const a = seedWorkspace(3);
    const b = seedWorkspace(3);
    const cores = [coreTarget("wsA", a.db), coreTarget("wsB", b.db)];
    const refs: FileRef[] = [
      { workspaceId: "wsB", fileId: b.ids[2] },
      { workspaceId: "wsA", fileId: a.ids[0] },
      { workspaceId: "wsB", fileId: b.ids[0] },
      { workspaceId: "wsA", fileId: a.ids[1] },
    ];
    const res = searchCollectionManual(cores, refs, {});
    expect(res.items.map((i) => `${i.workspaceId}/${i.relPath}`)).toEqual([
      "wsB/003.mp4",
      "wsA/001.mp4",
      "wsB/001.mp4",
      "wsA/002.mp4",
    ]);
  });

  it("keeps the relative manual order when a filter drops entries", () => {
    const { db, ids } = seedWorkspace(6, (i) => ({
      kind: i % 2 === 0 ? "image" : "video",
    }));
    const cores = [coreTarget("ws1", db)];
    const order = [...ids].reverse();
    const res = searchCollectionManual(cores, refsOf("ws1", order), {
      kind: "video",
    });
    expect(pathsOf(res)).toEqual(["005.mp4", "003.mp4", "001.mp4"]);
  });

  it("fills whole pages even when a filter drops most refs", () => {
    const { db, ids } = seedWorkspace(20, (i) => ({
      kind: i % 5 === 0 ? "video" : "image",
    }));
    const cores = [coreTarget("ws1", db)];
    const res = searchCollectionManual(cores, refsOf("ws1", ids), {
      kind: "video",
      limit: 2,
    });
    expect(pathsOf(res)).toEqual(["005.mp4", "010.mp4"]);
    // The remaining two matches are still reachable through the cursor.
    expect(
      pageAll(cores, refsOf("ws1", ids), { kind: "video", limit: 2 }),
    ).toEqual(["005.mp4", "010.mp4", "015.mp4", "020.mp4"]);
  });

  it("resumes from a plain numeric cursor, the way backward paging sends it", () => {
    // filesSearchPreviousCursor emits an offset with no seek key and expects the
    // main process to count from the start. Manual order used to discard it and
    // hand back the head of the collection in the middle of the list.
    const { db, ids } = seedWorkspace(10);
    const cores = [coreTarget("ws1", db)];
    const res = searchCollectionManual(cores, refsOf("ws1", ids), {
      limit: 3,
      cursor: 4,
    });
    expect(pathsOf(res)).toEqual(["005.mp4", "006.mp4", "007.mp4"]);
  });

  it("counts real rows, not refs, when a filter thins the numeric offset", () => {
    const { db, ids } = seedWorkspace(10, (i) => ({
      kind: i % 2 === 0 ? "image" : "video",
    }));
    const cores = [coreTarget("ws1", db)];
    // Videos are 001, 003, 005, 007, 009 — skipping two rows lands on 005.
    const res = searchCollectionManual(cores, refsOf("ws1", ids), {
      kind: "video",
      limit: 2,
      cursor: 2,
    });
    expect(pathsOf(res)).toEqual(["005.mp4", "007.mp4"]);
  });

  it("returns the same rows whether a page is reached forwards or by offset", () => {
    const { db, ids } = seedWorkspace(12);
    const cores = [coreTarget("ws1", db)];
    const refs = refsOf("ws1", ids);
    const first = searchCollectionManual(cores, refs, { limit: 4 });
    const second = searchCollectionManual(cores, refs, {
      limit: 4,
      cursor: first.nextCursor ?? undefined,
    });
    const byOffset = searchCollectionManual(cores, refs, {
      limit: 4,
      cursor: 4,
    });
    expect(pathsOf(byOffset)).toEqual(pathsOf(second));
  });

  it("ignores refs whose workspace is not among the cores", () => {
    const { db, ids } = seedWorkspace(2);
    const cores = [coreTarget("ws1", db)];
    const refs = [{ workspaceId: "gone", fileId: 999 }, ...refsOf("ws1", ids)];
    expect(pathsOf(searchCollectionManual(cores, refs, {}))).toEqual([
      "001.mp4",
      "002.mp4",
    ]);
  });

  it("returns an empty page for an empty collection", () => {
    const { db } = seedWorkspace(2);
    const res = searchCollectionManual([coreTarget("ws1", db)], [], {});
    expect(res.items).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it("differs from the default sort, which ignores the refs order", () => {
    const { db, ids } = seedWorkspace(4);
    const cores = [coreTarget("ws1", db)];
    const order = [...ids].reverse();
    const manual = pathsOf(
      searchCollectionManual(cores, refsOf("ws1", order), {}),
    );
    const bySort = pathsOf(searchCollection(cores, refsOf("ws1", order), {}));
    expect(manual).toEqual(["004.mp4", "003.mp4", "002.mp4", "001.mp4"]);
    expect(bySort).toEqual(["001.mp4", "002.mp4", "003.mp4", "004.mp4"]);
  });
});

describe("Workspaces.reorderCollectionItems", () => {
  function withCollection(fileIds: number[]) {
    const ws = new Workspaces();
    const collection = ws.addCollection("Mix");
    for (const id of fileIds) ws.addToCollection(collection.id, "ws1", id);
    return { ws, id: collection.id };
  }

  function itemsOf(ws: InstanceType<typeof Workspaces>, id: string): number[] {
    const c = ws.collections().find((x) => x.id === id);
    return (c?.items ?? []).map((i) => i.fileId);
  }

  it("adds new files at the end so the existing order survives", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    expect(itemsOf(ws, id)).toEqual([1, 2, 3]);
  });

  it("replaces the order with the one given", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 3 },
      { workspaceId: "ws1", fileId: 1 },
      { workspaceId: "ws1", fileId: 2 },
    ]);
    expect(itemsOf(ws, id)).toEqual([3, 1, 2]);
  });

  it("persists the order across a reload", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 2 },
      { workspaceId: "ws1", fileId: 3 },
      { workspaceId: "ws1", fileId: 1 },
    ]);
    expect(itemsOf(new Workspaces(), id)).toEqual([2, 3, 1]);
  });

  it("ignores refs the collection does not hold", () => {
    const { ws, id } = withCollection([1, 2]);
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 99 },
      { workspaceId: "elsewhere", fileId: 1 },
      { workspaceId: "ws1", fileId: 2 },
      { workspaceId: "ws1", fileId: 1 },
    ]);
    expect(itemsOf(ws, id)).toEqual([2, 1]);
    expect(itemsOf(ws, id)).toHaveLength(2);
  });

  it("leaves unlisted items exactly where they are", () => {
    // The renderer can only describe the window it has loaded, so a partial
    // order must not fling the rest of a long collection around.
    const { ws, id } = withCollection([1, 2, 3, 4, 5, 6]);
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 5 },
      { workspaceId: "ws1", fileId: 3 },
    ]);
    // 3 and 5 swap the two slots they held; 1, 2, 4 and 6 do not budge.
    expect(itemsOf(ws, id)).toEqual([1, 2, 5, 4, 3, 6]);
  });

  it("rearranges a loaded window without disturbing the pages around it", () => {
    const { ws, id } = withCollection([1, 2, 3, 4, 5, 6, 7, 8]);
    // Window = items 4..6, reversed by the user.
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 6 },
      { workspaceId: "ws1", fileId: 5 },
      { workspaceId: "ws1", fileId: 4 },
    ]);
    expect(itemsOf(ws, id)).toEqual([1, 2, 3, 6, 5, 4, 7, 8]);
  });

  it("never drops items, even for an empty order", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    ws.reorderCollectionItems(id, []);
    expect(itemsOf(ws, id)).toEqual([1, 2, 3]);
  });

  it("ignores a repeated ref rather than duplicating the item", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 3 },
      { workspaceId: "ws1", fileId: 3 },
      { workspaceId: "ws1", fileId: 1 },
    ]);
    expect(itemsOf(ws, id)).toEqual([3, 2, 1]);
  });

  it("is a no-op for an unknown collection id", () => {
    const { ws, id } = withCollection([1, 2]);
    ws.reorderCollectionItems("nope", [{ workspaceId: "ws1", fileId: 2 }]);
    expect(itemsOf(ws, id)).toEqual([1, 2]);
  });

  it("bumps updatedAt so the change is visible to callers watching it", () => {
    const { ws, id } = withCollection([1, 2]);
    const before = ws.collections().find((c) => c.id === id)!.updatedAt;
    ws.reorderCollectionItems(id, [
      { workspaceId: "ws1", fileId: 2 },
      { workspaceId: "ws1", fileId: 1 },
    ]);
    const after = ws.collections().find((c) => c.id === id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("reorders Watch Later too: the lock guards the collection, not its contents", () => {
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "ws1", 1);
    ws.addToCollection(WATCH_LATER_ID, "ws1", 2);
    ws.reorderCollectionItems(WATCH_LATER_ID, [
      { workspaceId: "ws1", fileId: 2 },
      { workspaceId: "ws1", fileId: 1 },
    ]);
    expect(itemsOf(ws, WATCH_LATER_ID)).toEqual([2, 1]);
  });

  it("is idempotent when applied twice", () => {
    const { ws, id } = withCollection([1, 2, 3]);
    const order = [
      { workspaceId: "ws1", fileId: 3 },
      { workspaceId: "ws1", fileId: 2 },
      { workspaceId: "ws1", fileId: 1 },
    ];
    ws.reorderCollectionItems(id, order);
    ws.reorderCollectionItems(id, order);
    expect(itemsOf(ws, id)).toEqual([3, 2, 1]);
  });
});
