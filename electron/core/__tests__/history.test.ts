// Regression tests for the cross-file play-history timeline (history.ts) and its
// cross-workspace merge (listHistoryWorkspaces).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../db.js";
import type { Core } from "../index.js";
import {
  clearPlayHistory,
  deleteFromIndex,
  listPlayHistory,
} from "../queries.js";
import { listHistoryWorkspaces, type CoreTarget } from "../crossWorkspace.js";
import type { HistoryQuery } from "../types.js";
import {
  insertFile,
  LEGACY_METADATA_DDL,
  newDb,
  newSharedDbs,
} from "./helpers.js";
import { upsertScanRoot } from "../queries.js";

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
    // The last row's key, which the next page seeks past.
    expect(p1.nextCursor).toEqual({ at: 3, id: 2, ws: "wsA" });
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

describe("listPlayHistory over the shared library", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-history-lib-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lists only events for files alive in this workspace", () => {
    const library = path.join(dir, "library.sqlite");
    const a = openDb(path.join(dir, "a.sqlite"), library);
    const b = openDb(path.join(dir, "b.sqlite"), library);
    try {
      const ra = upsertScanRoot(a, "/a", "a");
      const rb = upsertScanRoot(b, "/b", "b");
      const onlyA = insertFile(a, ra, { relPath: "x.mp4", contentHash: "hx" });
      const shared = insertFile(a, ra, { relPath: "s.mp4", contentHash: "hs" });
      insertFile(b, rb, { relPath: "s.mp4", contentHash: "hs" });
      // Many newer events of A's own file ahead of the shared one.
      for (let t = 1000; t < 1600; t++) insertPlay(a, onlyA, t);
      insertPlay(a, shared, 10);

      const page = listPlayHistory(b, {});
      expect(page.items.map((r) => r.playedAt)).toEqual([10]);
      expect(listPlayHistory(a, { limit: 1 }).items[0].playedAt).toBe(1599);
    } finally {
      a.close();
      b.close();
    }
  });

  it("collects a workspace's few events without reading the library's", () => {
    const library = path.join(dir, "library.sqlite");
    const a = openDb(path.join(dir, "a.sqlite"), library);
    const b = openDb(path.join(dir, "b.sqlite"), library);
    try {
      const ra = upsertScanRoot(a, "/a", "a");
      const rb = upsertScanRoot(b, "/b", "b");
      const busy = insertFile(a, ra, {
        relPath: "busy.mp4",
        contentHash: "hb",
      });
      const x = insertFile(b, rb, { relPath: "x.mp4", contentHash: "hx" });
      const y = insertFile(b, rb, { relPath: "y.mp4", contentHash: "hy" });
      // Far more events in A than OWN_SORT_MAX, interleaved with B's few.
      a.transaction(() => {
        for (let t = 0; t < 30_000; t++) insertPlay(a, busy, t * 2);
      })();
      for (const [file, at] of [
        [x, 101],
        [y, 303],
        [x, 505],
        [x, 507],
        [y, 909],
      ] as const) {
        insertPlay(b, file, at, at === 303 ? "external" : "browser");
      }

      const page = listPlayHistory(b, { limit: 2 });
      expect(page.items.map((r) => [r.relPath, r.playedAt])).toEqual([
        ["y.mp4", 909],
        ["x.mp4", 507],
      ]);
      expect(page.items.map((r) => r.playCount)).toEqual([2, 3]);
      const rest = listPlayHistory(b, { limit: 2, cursor: page.nextCursor! });
      expect(rest.items.map((r) => r.playedAt)).toEqual([303, 101]);
      expect(rest.nextCursor).toBeNull();
      expect(
        listPlayHistory(b, { via: "external" }).items.map((r) => r.playedAt),
      ).toEqual([303]);
      // Past the first batch of raw events: B's own, still in order.
      b.transaction(() => {
        for (let t = 0; t < 1200; t++) {
          insertPlay(b, t % 2 === 0 ? x : y, 100_000 + t);
        }
      })();
      const deep = listPlayHistory(b, { limit: 100, cursor: 1000 });
      expect(deep.items.map((r) => r.playedAt)).toEqual(
        Array.from({ length: 100 }, (_, i) => 100_000 + 199 - i),
      );
      // A's own events are most of the library: still streamed, same order.
      expect(listPlayHistory(a, { limit: 1 }).items[0].playedAt).toBe(59_998);
    } finally {
      a.close();
      b.close();
    }
  });
});

describe("listHistoryWorkspaces keyset paging", () => {
  /** Every page of `limit`, following nextCursor from the first one. */
  function pageThrough(
    targets: CoreTarget[],
    query: HistoryQuery,
    limit: number,
  ): string[] {
    const rows: string[] = [];
    let cursor: HistoryQuery["cursor"] = 0;
    while (cursor !== undefined) {
      const page = listHistoryWorkspaces(targets, { ...query, limit, cursor });
      rows.push(
        ...page.items.map(
          (r) => `${r.workspaceId}:${r.historyId}@${r.playedAt}`,
        ),
      );
      cursor = page.nextCursor ?? undefined;
    }
    return rows;
  }

  it("pages through ties, runs, shared plays and a workspace on its own tables as one listing does", () => {
    const { dbs, cleanup } = newSharedDbs(3);
    try {
      const [a, b, c] = dbs;
      // "a" still holds its own metadata: its event ids are its own and can
      // equal the library's, and it sorts after the others on a tie.
      a.db.exec(LEGACY_METADATA_DDL);
      const file = (ws: (typeof dbs)[number], hash: string) =>
        insertFile(ws.db, ws.rootId, {
          relPath: `${hash}.mp4`,
          root: ws.root,
          contentHash: hash,
        });
      file(a, "p");
      file(a, "q");
      file(b, "s");
      file(c, "s");
      file(b, "x");
      file(c, "y");
      let seed = 11;
      const rnd = (n: number) => {
        seed = (seed * 16807) % 2147483647;
        return seed % n;
      };
      // A few seconds only, so most events share played_at with others, and
      // few keys, so runs form and cross page boundaries.
      const play = (db: DB, keys: string[], count: number) => {
        const ins = db.prepare(
          "INSERT INTO play_history (meta_key, played_at, via) VALUES (?, ?, ?)",
        );
        for (let i = 0; i < count; i++) {
          ins.run(
            keys[rnd(keys.length)],
            rnd(8),
            rnd(3) === 0 ? "external" : "browser",
          );
        }
      };
      play(b.db, ["s", "x", "y"], 80);
      play(a.db, ["p", "q"], 40);
      // The same (played_at, id) in the library and in "a"'s own table: two
      // different plays, both listed, the library's first.
      for (const [db, key, at] of [
        [b.db, "x", 7],
        [a.db, "p", 7],
        [b.db, "y", 3],
        [a.db, "q", 3],
      ] as const) {
        db.prepare(
          "INSERT INTO play_history (id, meta_key, played_at, via) VALUES (?, ?, ?, 'external')",
        ).run(at === 7 ? 1000 : 1001, key, at);
      }
      const targets = [
        coreTarget("a", a.db),
        coreTarget("b", b.db),
        coreTarget("c", c.db),
      ];

      for (const query of [{}, { via: "external" as const }]) {
        const all = listHistoryWorkspaces(targets, { ...query, limit: 500 });
        expect(all.nextCursor).toBeNull();
        expect(all.items.length).toBeGreaterThan(20);
        const expected = all.items.map(
          (r) => `${r.workspaceId}:${r.historyId}@${r.playedAt}`,
        );
        for (const limit of [1, 2, 3, 5]) {
          expect(pageThrough(targets, query, limit)).toEqual(expected);
        }
        for (const target of targets) {
          const one = listHistoryWorkspaces([target], { ...query, limit: 500 });
          const oneExpected = one.items.map(
            (r) => `${r.workspaceId}:${r.historyId}@${r.playedAt}`,
          );
          for (const limit of [1, 2, 3]) {
            expect(pageThrough([target], query, limit)).toEqual(oneExpected);
          }
        }
      }
    } finally {
      cleanup();
    }
  });

  it("does not show the rest of a run that a page ended on as a new row", () => {
    const { db, rootId } = newDb();
    try {
      const a = insertFile(db, rootId, { relPath: "a.mp4" });
      const b = insertFile(db, rootId, { relPath: "b.mp4" });
      // Newest first: A A A (one run, two of them on one second), then B.
      insertPlay(db, b, 10);
      insertPlay(db, a, 20);
      insertPlay(db, a, 30);
      insertPlay(db, a, 30);
      const target = coreTarget("w", db);

      const p1 = listHistoryWorkspaces([target], { limit: 1 });
      expect(p1.items.map((r) => r.relPath)).toEqual(["a.mp4"]);
      const p2 = listHistoryWorkspaces([target], {
        limit: 1,
        cursor: p1.nextCursor!,
      });
      expect(p2.items.map((r) => [r.relPath, r.playedAt])).toEqual([
        ["b.mp4", 10],
      ]);
      expect(p2.nextCursor).toBeNull();
    } finally {
      db.close();
    }
  });
});
