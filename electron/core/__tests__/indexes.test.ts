// Query-plan regression tests for the performance indexes (#16). These pin the
// EXPLAIN QUERY PLAN shape of the hot queries so a schema or query change that
// silently reintroduces a full scan / temp b-tree sort fails loudly. All of
// these run synchronously on the main process (better-sqlite3), so plan
// regressions translate directly into UI/IPC stalls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db.js";
import type { SearchQuery } from "../types.js";
import {
  FILE_COLS,
  FILE_FROM,
  folderCondition,
  folderRange,
  orderByFor,
  searchFiles,
  sortValueOf,
  type SeekPosition,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

function plan(db: DB, sql: string): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as {
    detail: string;
  }[];
  return rows.map((r) => r.detail).join("\n");
}

/**
 * An unfiltered sort without searchFiles' INDEXED BY: what these tests check
 * is that the index can serve the order once the planner has statistics. The
 * pinned plans the app runs are covered by the describe at the end (#363).
 */
function searchSql(sort: string | undefined, dir: string | undefined): string {
  return `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL ORDER BY ${orderByFor(sort, dir)} LIMIT 101 OFFSET 0`;
}

describe("index query plans", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    for (let i = 0; i < 100; i++) {
      insertFile(db, rootId, {
        relPath: `dir/v${String(i).padStart(3, "0")}.mp4`,
        capturedAt: i % 3 ? 1_700_000_000 + i : null,
        btime: i % 4 ? 1_690_000_000 + i : null,
      });
    }
    db.exec("ANALYZE");
  });
  afterEach(() => db.close());

  it("countFiles scans the partial live-rows index, not the table", () => {
    // Only assert the positive (index usage): some SQLite versions word a
    // covering plan as "SCAN files USING COVERING INDEX ...", so a negative
    // "no SCAN files" check would be brittle across versions.
    const p = plan(db, "SELECT COUNT(*) FROM files WHERE deleted_at IS NULL");
    expect(p).toContain("COVERING INDEX idx_files_alive");
  });

  it("the In progress filter starts from the resume-point index", () => {
    const p = plan(
      db,
      `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL AND f.meta_key IN (SELECT meta_key FROM file_meta WHERE resume_position IS NOT NULL) ORDER BY ${orderByFor(undefined, undefined)} LIMIT 101 OFFSET 0`,
    );
    expect(p).toContain("idx_file_meta_resume");
  });

  it("sort=name uses idx_files_alive_name_key in both directions", () => {
    for (const dir of ["asc", "desc"]) {
      const p = plan(db, searchSql("name", dir));
      expect(p).toContain("idx_files_alive_name_key");
      expect(p).not.toContain("TEMP B-TREE");
    }
  });

  describe("folder view", () => {
    // The fixture above keeps every file in dir/, where a range covering the
    // whole table is rightly planned as a scan. Real libraries spread over
    // folders, so give the planner some rows outside the one being listed.
    beforeEach(() => {
      for (let i = 0; i < 900; i++) {
        insertFile(db, rootId, { relPath: `other${i % 7}/v${i}.mp4` });
      }
      db.exec("ANALYZE");
    });

    // EXPLAIN needs literals where the statement would bind values.
    const bind = (sql: string) =>
      sql
        .replace("f.rel_path >= ?", "f.rel_path >= 'dir/'")
        .replace("f.rel_path < ?", "f.rel_path < 'dir0'")
        .replace("substr(f.rel_path, ?), ?", "substr(f.rel_path, 5), '/'");

    // The folder is found on rel_path, the order is name_key's (#292), so the
    // folder's own files are sorted: the folder bounds the work, the index on
    // rel_path keeps the rest of the library out of it.
    it("a folder-scoped sort=name ranges over idx_files_alive_rel_path and sorts that folder", () => {
      const direct = folderCondition(folderRange("dir", "/"), false);
      const p = plan(
        db,
        bind(
          `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL AND ${direct.sql} ORDER BY ${orderByFor("name", "asc")} LIMIT 101 OFFSET 0`,
        ),
      );
      expect(p).toContain(
        "idx_files_alive_rel_path (rel_path>? AND rel_path<?)",
      );
    });

    it("counting a folder's children is a range search on idx_files_alive_rel_path", () => {
      const p = plan(
        db,
        `SELECT substr(rest, 1, instr(rest, '/') - 1) AS name, COUNT(*)
           FROM (SELECT substr(f.rel_path, 5) AS rest FROM files f
                  WHERE f.deleted_at IS NULL AND f.rel_path >= 'dir/' AND f.rel_path < 'dir0')
          WHERE instr(rest, '/') > 0 GROUP BY name`,
      );
      expect(p).toContain("SEARCH f USING INDEX idx_files_alive_rel_path");
    });
  });

  it("sort=captured (default desc) uses idx_files_alive_captured", () => {
    const p = plan(db, searchSql("captured", "desc"));
    expect(p).toContain("idx_files_alive_captured");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("sort=addedAt (the timeline's added axis) uses idx_files_alive_added", () => {
    const p = plan(db, searchSql("addedAt", "desc"));
    expect(p).toContain("idx_files_alive_added");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("seeking into the added axis uses idx_files_alive_added too", () => {
    // A jump to a day's head (every row on that second kept)…
    const head = plan(
      db,
      `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL AND (f.created_at <= 1700000000) ORDER BY ${orderByFor("addedAt", "desc")} LIMIT 101`,
    );
    expect(head).toContain("idx_files_alive_added");
    expect(head).not.toContain("TEMP B-TREE");
    // …and the next page after a row.
    const next = plan(
      db,
      `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL AND (f.created_at < 1700000000 OR (f.created_at = 1700000000 AND f.id > 5)) ORDER BY ${orderByFor("addedAt", "desc")} LIMIT 101`,
    );
    expect(next).toContain("idx_files_alive_added");
    expect(next).not.toContain("TEMP B-TREE");
  });

  it("sort=btime (default desc) uses idx_files_alive_btime", () => {
    const p = plan(db, searchSql("btime", "desc"));
    expect(p).toContain("idx_files_alive_btime");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("sort=hash (default asc) uses idx_files_alive_hash", () => {
    const p = plan(db, searchSql("hash", "asc"));
    expect(p).toContain("idx_files_alive_hash");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("tag-name prefix autocomplete is a range search on idx_tags_manual_name", () => {
    // Mirrors listTagNames' SQL: the namespace = '' predicate restricts completion
    // to user-owned tags, and the partial index over the same predicate keeps the
    // range search covering. The NOCASE collation on ORDER BY lets the index
    // satisfy the sort too (no temp b-tree).
    const p = plan(
      db,
      "SELECT name FROM tags WHERE namespace = '' AND name LIKE 'pre%' ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 20",
    );
    expect(p).toContain(
      "SEARCH tags USING COVERING INDEX idx_tags_manual_name",
    );
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("sort=name desc keeps a deterministic reversed order (id tiebreak follows direction)", () => {
    // The tiebreak changed from a fixed "id ASC" to follow the sort direction
    // so the index can serve the DESC scan; pin the resulting row order.
    const asc = searchFiles(db, { sort: "name", sortDir: "asc", limit: 500 });
    const desc = searchFiles(db, { sort: "name", sortDir: "desc", limit: 500 });
    expect(desc.items.map((f) => f.id)).toEqual(
      asc.items.map((f) => f.id).reverse(),
    );
  });
});

// Workspace DBs are never ANALYZEd, so these are the plans the app runs. The
// tests above run ANALYZE first, which hides a plan that only holds with
// statistics; dropping sqlite_stat1 afterwards is not enough, as the loaded
// statistics stay in effect on the connection.
describe("searchFiles plans without statistics (#363)", () => {
  let db: DB;
  beforeEach(() => {
    let rootId: number;
    ({ db, rootId } = newDb());
    for (let i = 0; i < 100; i++) {
      insertFile(db, rootId, {
        relPath: `dir/v${String(i).padStart(3, "0")}.mp4`,
        capturedAt: i % 3 ? 1_700_000_000 + i : null,
        btime: i % 4 ? 1_690_000_000 + i : null,
      });
    }
  });
  afterEach(() => db.close());

  /** The plan of the statement searchFiles runs, with its bound values. */
  function searchPlan(query: SearchQuery, seek?: SeekPosition): string {
    let captured: { sql: string; args: unknown[] } | undefined;
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const stmt = prepare(sql);
      if (captured || !sql.includes("FROM files f")) return stmt;
      const all = stmt.all.bind(stmt);
      return Object.assign(stmt, {
        all: (...args: unknown[]) => {
          captured = { sql, args };
          return all(...args);
        },
      });
    });
    try {
      searchFiles(db, query, seek, { skipTags: true });
    } finally {
      spy.mockRestore();
    }
    if (!captured) throw new Error("searchFiles ran no query");
    const rows = db
      .prepare(`EXPLAIN QUERY PLAN ${captured.sql}`)
      .all(...captured.args) as { detail: string }[];
    return rows.map((r) => r.detail).join("\n");
  }

  // A seek key of the sort's own type: a string for name and hash, a number
  // otherwise.
  const seekFor = (sort: string): SeekPosition => ({
    v:
      sort === "name"
        ? "dir/v050.mp4"
        : sort === "hash"
          ? "3fa9c1d2"
          : 1_700_000_050,
    id: 50,
    tie: "after-id",
  });

  it.each<[string, "asc" | "desc" | undefined, string]>([
    ["name", "asc", "idx_files_alive_name_key"],
    ["name", "desc", "idx_files_alive_name_key"],
    ["captured", "desc", "idx_files_alive_captured"],
    ["captured", undefined, "idx_files_alive_captured"],
    ["btime", "desc", "idx_files_alive_btime"],
    ["addedAt", "desc", "idx_files_alive_added"],
    ["hash", "asc", "idx_files_alive_hash"],
    ["hash", undefined, "idx_files_alive_hash"],
  ])(
    "sort=%s %s walks %s, first page and after a seek",
    (sort, sortDir, index) => {
      for (const seek of [undefined, seekFor(sort)]) {
        const p = searchPlan({ sort, sortDir }, seek);
        expect(p).toContain(index);
        expect(p).not.toContain("TEMP B-TREE");
      }
    },
  );

  it("narrows a single kind through its index", () => {
    // json_each(?) would hide the list's size from a planner with no
    // statistics, and it would walk every live row instead.
    expect(searchPlan({ kinds: ["audio"] })).toContain("idx_files_kind");
  });

  it("leaves every filtered list to the planner", () => {
    // Without statistics, nothing tells how few rows a filter leaves; for a
    // rare one, walking the sort order reads every live row.
    for (const query of [
      { kinds: ["image"] },
      { q: "ab" },
      { q: "abc" },
      { q: "hash:ab" },
      { q: "ext:gif" },
      { q: "tag:t" },
      { tags: ["t"] },
      { favorite: true },
      { played: true },
      { fileIds: [1, 2, 3] },
      { capturedFrom: 0, capturedTo: 1 },
      { playedFrom: 0, playedTo: 1 },
    ]) {
      const p = searchPlan({ ...query, sort: "name", sortDir: "asc" });
      expect(p, JSON.stringify(query)).not.toContain(
        "idx_files_alive_name_key",
      );
    }
  });

  it("leaves the ascending date orders to the planner (their indexes are newest first)", () => {
    const indexes = {
      captured: "idx_files_alive_captured",
      btime: "idx_files_alive_btime",
      addedAt: "idx_files_alive_added",
    };
    for (const [sort, index] of Object.entries(indexes)) {
      const p = searchPlan({ sort, sortDir: "asc" });
      expect(p, sort).not.toContain(index);
    }
  });

  it("leaves the descending hash order to the planner (its index is ascending)", () => {
    expect(searchPlan({ sort: "hash", sortDir: "desc" })).not.toContain(
      "idx_files_alive_hash",
    );
  });

  it("leaves a page in the NULL tail to the planner", () => {
    for (const [sort, sortDir] of [
      ["captured", "desc"],
      ["btime", "desc"],
      ["hash", "asc"],
    ] as const) {
      const p = searchPlan(
        { sort, sortDir },
        { v: null, id: 50, tie: "after-id" },
      );
      expect(p, sort).not.toContain(`idx_files_alive_${sort}`);
    }
  });

  it("pages through the hash order under the pinned index, NULLs last", () => {
    // The plan tests above see only NULL hashes; give the walk both kinds and
    // check its rows against the planner's own order.
    db.exec(
      "UPDATE files SET content_hash = printf('%08x', (id * 2654435761) % 4294967296) WHERE id % 3 != 0",
    );
    const expected = (
      db
        .prepare(
          `SELECT f.id FROM files f NOT INDEXED WHERE f.deleted_at IS NULL ORDER BY ${orderByFor("hash", "asc")}`,
        )
        .all() as { id: number }[]
    ).map((r) => r.id);
    const seen: number[] = [];
    let seek: SeekPosition | undefined;
    for (;;) {
      const { items } = searchFiles(db, { sort: "hash", limit: 7 }, seek, {
        skipTags: true,
      });
      if (items.length === 0) break;
      seen.push(...items.map((f) => f.id));
      const last = items[items.length - 1];
      seek = { v: sortValueOf("hash", last), id: last.id, tie: "after-id" };
    }
    expect(seen).toEqual(expected);
  });

  it("returns an empty page for a seek with nothing after it, under the pinned index", () => {
    // The key sits in the NULL tail of an earlier workspace, so every row
    // after it was already returned. "AND (0)" under INDEXED BY would throw.
    const res = searchFiles(
      db,
      { sort: "captured", sortDir: "desc" },
      { v: null, id: 1, tie: "none" },
    );
    expect(res).toEqual({ items: [], nextCursor: null });
  });
});
