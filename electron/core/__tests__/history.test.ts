// Regression tests for the cross-file play-history timeline (history.ts) and its
// cross-workspace merge (listHistoryWorkspaces).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import type { Core } from "../index.js";
import {
  clearPlayHistory,
  deleteFromIndex,
  listPlayHistory,
} from "../queries.js";
import { listHistoryWorkspaces, type CoreTarget } from "../crossWorkspace.js";
import { insertFile, newDb } from "./helpers.js";

/** Insert a play event with an explicit timestamp (recordPlay always uses "now"). */
function insertPlay(
  db: DB,
  fileId: number,
  playedAt: number,
  via: "browser" | "external" = "browser",
): void {
  const row = db
    .prepare("SELECT meta_key AS k FROM files WHERE id = ?")
    .get(fileId) as { k: string };
  db.prepare(
    "INSERT INTO play_history (meta_key, played_at, position, via) VALUES (?, ?, NULL, ?)",
  ).run(row.k, playedAt, via);
}

function coreTarget(id: string, db: DB): CoreTarget {
  return { id, core: { db } as Core };
}

describe("listPlayHistory", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("returns events newest-first with file info attached", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    insertPlay(db, a, 100);
    insertPlay(db, b, 200, "external");

    const page = listPlayHistory(db, {});
    expect(page.items.map((r) => r.relPath)).toEqual(["b.mp4", "a.mp4"]);
    expect(page.items[0].via).toBe("external");
    expect(page.items[0].playedAt).toBe(200);
    expect(page.nextCursor).toBeNull();
  });

  it("collapses consecutive runs of the same file and reports the total play count", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    // Timeline (oldest→newest): A, A, B, A → collapsed newest-first: A, B, A
    insertPlay(db, a, 10);
    insertPlay(db, a, 20);
    insertPlay(db, b, 30);
    insertPlay(db, a, 40);

    const page = listPlayHistory(db, {});
    expect(page.items.map((r) => r.relPath)).toEqual([
      "a.mp4",
      "b.mp4",
      "a.mp4",
    ]);
    // The collapsed run keeps its newest event's timestamp.
    expect(page.items.map((r) => r.playedAt)).toEqual([40, 30, 20]);
    expect(page.items[0].playCount).toBe(3);
    expect(page.items[1].playCount).toBe(1);
  });

  it("paginates over collapsed rows with limit+1 / nextCursor", () => {
    const ids = Array.from({ length: 5 }, (_, i) =>
      insertFile(db, rootId, { relPath: `v${i}.mp4` }),
    );
    // Each file played twice back-to-back → 10 events, 5 collapsed rows.
    ids.forEach((id, i) => {
      insertPlay(db, id, i * 10 + 1);
      insertPlay(db, id, i * 10 + 2);
    });

    const p1 = listPlayHistory(db, { limit: 2 });
    expect(p1.items.map((r) => r.relPath)).toEqual(["v4.mp4", "v3.mp4"]);
    expect(p1.nextCursor).toBe(2);
    const p2 = listPlayHistory(db, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((r) => r.relPath)).toEqual(["v2.mp4", "v1.mp4"]);
    const p3 = listPlayHistory(db, { limit: 2, cursor: p2.nextCursor! });
    expect(p3.items.map((r) => r.relPath)).toEqual(["v0.mp4"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("hides history of soft-deleted files", () => {
    const a = insertFile(db, rootId, { relPath: "gone.mp4" });
    const b = insertFile(db, rootId, { relPath: "kept.mp4" });
    insertPlay(db, a, 100);
    insertPlay(db, b, 200);
    deleteFromIndex(db, a);

    const page = listPlayHistory(db, {});
    expect(page.items.map((r) => r.relPath)).toEqual(["kept.mp4"]);
  });

  it("does not multiply rows when several files share a meta_key", () => {
    // Two copies of the same content (same content_hash → same meta_key).
    const a = insertFile(db, rootId, {
      relPath: "copy1.mp4",
      contentHash: "cafe",
    });
    insertFile(db, rootId, { relPath: "copy2.mp4", contentHash: "cafe" });
    insertPlay(db, a, 100);

    const page = listPlayHistory(db, {});
    expect(page.items.length).toBe(1);
    // The representative file is the lowest id.
    expect(page.items[0].relPath).toBe("copy1.mp4");
  });

  it("filters by via", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    insertPlay(db, a, 100, "browser");
    insertPlay(db, a, 200, "external");

    const ext = listPlayHistory(db, { via: "external" });
    expect(ext.items.length).toBe(1);
    expect(ext.items[0].playedAt).toBe(200);
  });

  it("clearPlayHistory removes everything", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    insertPlay(db, a, 100);
    clearPlayHistory(db);
    expect(listPlayHistory(db, {}).items).toEqual([]);
  });
});

describe("listHistoryWorkspaces", () => {
  const opened: DB[] = [];
  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  function newWs(id: string): { target: CoreTarget; rootId: number; db: DB } {
    const { db, rootId } = newDb();
    opened.push(db);
    return { target: coreTarget(id, db), rootId, db };
  }

  it("stamps workspaceId on the single-core fast path", () => {
    const ws = newWs("wsA");
    const a = insertFile(ws.db, ws.rootId, { relPath: "a.mp4" });
    insertPlay(ws.db, a, 100);

    const page = listHistoryWorkspaces([ws.target], {});
    expect(page.items[0].workspaceId).toBe("wsA");
  });

  it("interleaves two workspaces newest-first across page boundaries", () => {
    const wsA = newWs("wsA");
    const wsB = newWs("wsB");
    // Alternate timestamps between workspaces: A=1,3,5 / B=2,4,6
    const fa = insertFile(wsA.db, wsA.rootId, { relPath: "a.mp4" });
    const fb = insertFile(wsB.db, wsB.rootId, { relPath: "b.mp4" });
    const fa2 = insertFile(wsA.db, wsA.rootId, { relPath: "a2.mp4" });
    const fb2 = insertFile(wsB.db, wsB.rootId, { relPath: "b2.mp4" });
    insertPlay(wsA.db, fa, 1);
    insertPlay(wsB.db, fb, 2);
    insertPlay(wsA.db, fa2, 3);
    insertPlay(wsB.db, fb2, 4);
    insertPlay(wsA.db, fa, 5);
    insertPlay(wsB.db, fb, 6);

    const p1 = listHistoryWorkspaces([wsA.target, wsB.target], { limit: 4 });
    expect(p1.items.map((r) => [r.workspaceId, r.playedAt])).toEqual([
      ["wsB", 6],
      ["wsA", 5],
      ["wsB", 4],
      ["wsA", 3],
    ]);
    expect(p1.nextCursor).toBe(4);
    const p2 = listHistoryWorkspaces([wsA.target, wsB.target], {
      limit: 4,
      cursor: p1.nextCursor!,
    });
    expect(p2.items.map((r) => [r.workspaceId, r.playedAt])).toEqual([
      ["wsB", 2],
      ["wsA", 1],
    ]);
    expect(p2.nextCursor).toBeNull();
  });

  it("returns empty for no cores", () => {
    expect(listHistoryWorkspaces([], {})).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
