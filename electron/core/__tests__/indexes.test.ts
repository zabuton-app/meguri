// Query-plan regression tests for the performance indexes (#16). These pin the
// EXPLAIN QUERY PLAN shape of the hot queries so a schema or query change that
// silently reintroduces a full scan / temp b-tree sort fails loudly. All of
// these run synchronously on the main process (better-sqlite3), so plan
// regressions translate directly into UI/IPC stalls.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { FILE_COLS, FILE_FROM, orderByFor, searchFiles } from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

function plan(db: DB, sql: string): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as {
    detail: string;
  }[];
  return rows.map((r) => r.detail).join("\n");
}

/** The exact SQL shape searchFiles() emits for a bare (unfiltered) sort. */
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

  it("sort=name uses idx_files_alive_rel_path in both directions", () => {
    for (const dir of ["asc", "desc"]) {
      const p = plan(db, searchSql("name", dir));
      expect(p).toContain("idx_files_alive_rel_path");
      expect(p).not.toContain("TEMP B-TREE");
    }
  });

  it("sort=captured (default desc) uses idx_files_alive_captured", () => {
    const p = plan(db, searchSql("captured", "desc"));
    expect(p).toContain("idx_files_alive_captured");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("tag-name prefix autocomplete is a range search on idx_tags_name", () => {
    // Mirrors listTagNames' SQL: the NOCASE collation on ORDER BY lets the
    // index satisfy the sort too (no temp b-tree).
    const p = plan(
      db,
      "SELECT name FROM tags WHERE name LIKE 'pre%' ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 20",
    );
    expect(p).toContain("SEARCH tags USING COVERING INDEX idx_tags_name");
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
