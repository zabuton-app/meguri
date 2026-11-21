// Folder view queries: folders derived from rel_path (folderRange, listFolders,
// folderFiles) and the folder filter on searchFiles. Runs the real SQL on an
// in-memory DB; the Windows cases inject "\" as the separator.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import type { DB } from "../db.js";
import {
  FOLDER_FILE_FROM,
  fromFor,
  orderByFor,
  randomFiles,
  folderFiles,
  folderRange,
  listFolders,
  searchFiles,
} from "../queries.js";
import {
  folderFilesWorkspace,
  listFoldersWorkspace,
} from "../crossWorkspace.js";
import type { Core } from "../index.js";
import { insertFile, newDb } from "./helpers.js";

const WS = "ws1";
const target = (db: DB) => ({ id: WS, core: { db } as Core });

function markThumb(db: DB, id: number): void {
  db.prepare(
    "UPDATE files SET thumb_status = 'done', thumb_path = 'x.webp' WHERE id = ?",
  ).run(id);
}

function exclude(db: DB, id: number): void {
  db.prepare(
    "UPDATE files SET deleted_at = 1, excluded_at = 1 WHERE id = ?",
  ).run(id);
}

/**
 * A rel_path written the way the running OS's scan writes it. The describes
 * below that exercise the default separator (rather than injecting one) have to
 * seed natively, or nothing matches on Windows (#297).
 */
const rel = (p: string) => p.split("/").join(path.sep);

/** Seed the layout from quickstart.md, written with `sep`. */
function seed(db: DB, rootId: number, sep: string): Record<string, number> {
  const ids: Record<string, number> = {};
  for (const rel of [
    "root-a.mp4",
    "root-b.jpg",
    "Movie/m1.mp4",
    "Movie/2024/deep/d1.mp4",
    "Movies/ms1.mp4",
    "A_B/ab.jpg",
    "AxB/axb.jpg",
    "50% off [draft]/p.jpg",
    "Ep10/e10.mp4",
    "Ep2/e2.mp4",
    "ep3/e3.mp4",
    "OnlySub/inner/i1.jpg",
    "絵文字😀/x.jpg",
  ]) {
    ids[rel] = insertFile(db, rootId, { relPath: rel.split("/").join(sep) });
  }
  return ids;
}

describe("folderRange", () => {
  it("bounds a folder by its separator-terminated prefix", () => {
    expect(folderRange("Movie", "/")).toEqual({
      prefix: "Movie/",
      upper: "Movie0",
      start: 7,
      sep: "/",
    });
    expect(folderRange("a/b", "\\")).toEqual({
      prefix: "a\\b\\",
      upper: "a\\b]",
      start: 5,
      sep: "\\",
    });
  });

  it("leaves the root unbounded", () => {
    expect(folderRange("", "/")).toEqual({
      prefix: "",
      upper: null,
      start: 1,
      sep: "/",
    });
  });

  it("counts the start in code points, not UTF-16 units", () => {
    // "😀" is one character to SQLite's substr() but two JS code units.
    expect(folderRange("😀", "/").start).toBe(3);
  });
});

describe.each([
  ["posix", "/"],
  ["windows", "\\"],
])("listFolders (%s separators)", (_name, sep) => {
  let db: DB;
  let rootId: number;
  let ids: Record<string, number>;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    ids = seed(db, rootId, sep);
  });
  afterEach(() => db.close());

  const list = (path: string) => listFolders(db, path, { sep });

  it("lists the root's child folders in natural order, with recursive counts", () => {
    const res = list("");
    expect(res.path).toBe("");
    expect(res.folders.map((f) => [f.name, f.path, f.count])).toEqual([
      ["50% off [draft]", "50% off [draft]", 1],
      ["A_B", "A_B", 1],
      ["AxB", "AxB", 1],
      ["Ep2", "Ep2", 1],
      ["ep3", "ep3", 1],
      ["Ep10", "Ep10", 1],
      ["Movie", "Movie", 2],
      ["Movies", "Movies", 1],
      ["OnlySub", "OnlySub", 1],
      ["絵文字😀", "絵文字😀", 1],
    ]);
    expect(res.fileCount).toBe(2);
  });

  it("counts the subfolders each child holds", () => {
    const bySub = Object.fromEntries(
      list("").folders.map((f) => [f.name, f.subfolders]),
    );
    // Movie holds 2024/ (with deep/ below it — not a direct subfolder).
    expect(bySub["Movie"]).toBe(1);
    expect(bySub["OnlySub"]).toBe(1);
    expect(bySub["Movies"]).toBe(0);
    expect(list("Movie").folders[0].subfolders).toBe(1);
  });

  it("counts each subfolder once, and only while it holds live files", () => {
    const ins = (rel: string) =>
      insertFile(db, rootId, { relPath: rel.split("/").join(sep) });
    ins("Many/s1/a.mp4");
    ins("Many/s1/b.mp4");
    ins("Many/s2/c.mp4");
    exclude(db, ins("Many/gone/d.mp4"));
    const many = list("").folders.find((f) => f.name === "Many")!;
    expect(many.subfolders).toBe(2);
    expect(many.count).toBe(3);
  });

  it("keeps a folder apart from a sibling it prefixes", () => {
    const res = list("Movie");
    expect(res.folders.map((f) => f.path)).toEqual(["Movie/2024"]);
    expect(res.fileCount).toBe(1);
  });

  it("goes any depth and handles astral characters in the path", () => {
    expect(list("Movie/2024").folders.map((f) => f.path)).toEqual([
      "Movie/2024/deep",
    ]);
    expect(list("Movie/2024").fileCount).toBe(0);
    expect(list("絵文字😀").fileCount).toBe(1);
  });

  it("previews at most four files, thumbnails first", () => {
    for (let i = 0; i < 6; i++) {
      insertFile(db, rootId, {
        relPath: ["Many", `f${i}.jpg`].join(sep),
      });
    }
    const late = insertFile(db, rootId, {
      relPath: ["Many", "z-late.jpg"].join(sep),
    });
    markThumb(db, late);
    const many = list("").folders.find((f) => f.name === "Many")!;
    expect(many.count).toBe(7);
    expect(many.previews).toHaveLength(4);
    expect(many.previews[0].id).toBe(late);
  });

  it("builds a mosaic from grandchildren when a folder has no direct files", () => {
    const only = list("").folders.find((f) => f.name === "OnlySub")!;
    expect(only.previews.map((p) => p.id)).toEqual([
      ids["OnlySub/inner/i1.jpg"],
    ]);
  });

  it("ignores deleted and excluded files, dropping folders left empty", () => {
    exclude(db, ids["Movies/ms1.mp4"]);
    exclude(db, ids["Movie/m1.mp4"]);
    const res = list("");
    expect(res.folders.map((f) => f.name)).not.toContain("Movies");
    expect(res.folders.find((f) => f.name === "Movie")!.count).toBe(1);
  });

  it("falls back to the nearest ancestor that still has files", () => {
    exclude(db, ids["Movie/2024/deep/d1.mp4"]);
    expect(list("Movie/2024/deep").path).toBe("Movie");
    expect(list("Gone/away").path).toBe("");
  });
});

describe("searchFiles folder filter", () => {
  let db: DB;
  let rootId: number;
  let ids: Record<string, number>;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    ids = seed(db, rootId, path.sep);
  });
  afterEach(() => db.close());

  const idsOf = (res: { items: { id: number }[] }) =>
    res.items.map((r) => r.id).sort((a, b) => a - b);
  const expected = (...rels: string[]) =>
    rels.map((r) => ids[r]).sort((a, b) => a - b);

  it("returns only direct files when not recursive", () => {
    expect(
      idsOf(searchFiles(db, { folder: { path: "Movie", recursive: false } })),
    ).toEqual(expected("Movie/m1.mp4"));
    expect(
      idsOf(searchFiles(db, { folder: { path: "", recursive: false } })),
    ).toEqual(expected("root-a.mp4", "root-b.jpg"));
  });

  it("returns everything below when recursive, without the prefixed sibling", () => {
    expect(
      idsOf(searchFiles(db, { folder: { path: "Movie", recursive: true } })),
    ).toEqual(expected("Movie/m1.mp4", "Movie/2024/deep/d1.mp4"));
    expect(
      searchFiles(db, { folder: { path: "", recursive: true } }).items,
    ).toHaveLength(Object.keys(ids).length);
  });

  it("keeps LIKE metacharacters literal", () => {
    expect(
      idsOf(searchFiles(db, { folder: { path: "A_B", recursive: true } })),
    ).toEqual(expected("A_B/ab.jpg"));
    expect(
      idsOf(
        searchFiles(db, {
          folder: { path: "50% off [draft]", recursive: false },
        }),
      ),
    ).toEqual(expected("50% off [draft]/p.jpg"));
  });

  it("combines with other conditions and every sort", () => {
    for (const sort of [undefined, "name", "captured", "rating", "hash"]) {
      const res = searchFiles(db, {
        kinds: ["video"],
        sort,
        folder: { path: "Movie", recursive: true },
      });
      expect(idsOf(res)).toEqual(
        expected("Movie/m1.mp4", "Movie/2024/deep/d1.mp4"),
      );
    }
  });

  it("pages through a folder without leaking rows from outside it", () => {
    for (let i = 0; i < 5; i++) {
      insertFile(db, rootId, { relPath: rel(`Movie/p${i}.mp4`) });
    }
    const seen: number[] = [];
    let cursor: number | undefined = 0;
    while (cursor != null) {
      const res = searchFiles(db, {
        sort: "name",
        limit: 2,
        cursor,
        folder: { path: "Movie", recursive: false },
      });
      seen.push(...res.items.map((r) => r.id));
      cursor = typeof res.nextCursor === "number" ? res.nextCursor : undefined;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).has(ids["Movies/ms1.mp4"])).toBe(false);
  });

  it("reads Windows rel_paths with an injected separator", () => {
    const win = newDb();
    const a = insertFile(win.db, win.rootId, { relPath: "Movie\\m1.mp4" });
    insertFile(win.db, win.rootId, { relPath: "Movie\\2024\\d1.mp4" });
    insertFile(win.db, win.rootId, { relPath: "Movies\\ms1.mp4" });
    const res = searchFiles(
      win.db,
      { folder: { path: "Movie", recursive: false } },
      undefined,
      { sep: "\\" },
    );
    expect(res.items.map((r) => r.id)).toEqual([a]);
    win.db.close();
  });
});

describe("folderFiles", () => {
  let db: DB;
  let rootId: number;
  let ids: Record<string, number>;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    ids = seed(db, rootId, path.sep);
  });
  afterEach(() => db.close());

  it("expands folders to every live file below them, in rel_path order", () => {
    exclude(db, ids["A_B/ab.jpg"]);
    const res = folderFiles(db, ["Movie", "A_B"], { limit: 100 });
    expect(res[0]).toMatchObject({ path: "Movie", total: 2 });
    expect(res[0].rows.map((r) => r.relPath)).toEqual([
      rel("Movie/2024/deep/d1.mp4"),
      rel("Movie/m1.mp4"),
    ]);
    expect(res[1]).toEqual({ path: "A_B", total: 0, rows: [] });
  });

  it("carries each file's tags, as the bulk tag dialog tallies them", () => {
    const tag = db
      .prepare("INSERT INTO tags (name, namespace) VALUES ('beach', '')")
      .run().lastInsertRowid;
    const key = db
      .prepare("SELECT meta_key FROM files WHERE id = ?")
      .pluck()
      .get(ids["Movie/m1.mp4"]);
    db.prepare(
      "INSERT INTO meta_tags (meta_key, tag_id, source) VALUES (?, ?, 'manual')",
    ).run(key, tag);
    const [movie] = folderFiles(db, ["Movie"], { limit: 10 });
    const m1 = movie.rows.find((r) => r.id === ids["Movie/m1.mp4"])!;
    expect(m1.tags?.map((t) => t.name)).toEqual(["beach"]);
  });

  it("spends one row budget across the whole call but always reports totals", () => {
    for (let i = 0; i < 5; i++)
      insertFile(db, rootId, { relPath: rel(`Big/b${i}.jpg`) });
    const res = folderFiles(db, ["Big", "Movie"], { limit: 3 });
    expect(res[0]).toMatchObject({ path: "Big", total: 5 });
    expect(res[0].rows).toHaveLength(3);
    expect(res[1]).toEqual({ path: "Movie", total: 2, rows: [] });
  });
});

describe("folder queries at the workspace level", () => {
  it("stamps preview and expanded rows with the workspace", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: rel("Movie/m1.mp4") });
    const listing = listFoldersWorkspace(target(db), "");
    expect(listing.folders[0].previews[0].workspaceId).toBe(WS);
    const [expanded] = folderFilesWorkspace(target(db), ["Movie"], 10);
    expect(expanded.rows[0].workspaceId).toBe(WS);
    db.close();
  });

  it("expands the root to every live file", () => {
    const { db, rootId } = newDb();
    ["a.mp4", "Movie/m1.mp4", "😀/x.jpg"].forEach((relPath) =>
      insertFile(db, rootId, { relPath: rel(relPath) }),
    );
    const [root] = folderFiles(db, [""], { limit: 10 });
    expect(root.total).toBe(3);
    expect(root.rows).toHaveLength(3);
    db.close();
  });
});

describe("folderRange on Windows", () => {
  it("refuses a segment carrying the native separator", () => {
    // "a\\b" would otherwise name the same range as "a/b".
    expect(() => folderRange("a\\b", "\\")).toThrow();
    expect(() => folderRange("a\\b", "/")).not.toThrow();
  });
});

describe("folder plans without statistics", () => {
  // Workspace DBs are never ANALYZEd. Without stats the planner would take
  // idx_files_alive ("deleted_at IS NULL") or idx_files_thumb_status and walk
  // every live file — per child folder, for the mosaic. Each ranged folder
  // query has to stay on its own slice of the rel_path index.
  it("keeps ranged queries on idx_files_alive_rel_path", () => {
    const { db, rootId } = newDb();
    for (let i = 0; i < 50; i++) {
      const id = insertFile(db, rootId, {
        relPath: rel(`F${i % 5}/v${i}.mp4`),
      });
      markThumb(db, id);
    }
    const detail = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT f.id ${FOLDER_FILE_FROM}
            WHERE f.deleted_at IS NULL AND f.rel_path >= 'F1/' AND f.rel_path < 'F10'
              AND f.thumb_status = 'done' AND f.thumb_path IS NOT NULL
            ORDER BY f.rel_path LIMIT 4`,
        )
        .all() as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(detail).toContain("idx_files_alive_rel_path");
    expect(detail).not.toContain("TEMP B-TREE");
    // A folder-scoped search sorted by another index stays on the range too.
    const search = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT f.id ${FOLDER_FILE_FROM}
            WHERE f.deleted_at IS NULL AND f.rel_path >= 'F1/' AND f.rel_path < 'F10'
            ORDER BY ${orderByFor("captured", "desc")} LIMIT 101`,
        )
        .all() as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(search).toContain("idx_files_alive_rel_path");
    expect(() =>
      searchFiles(db, {
        sort: "captured",
        q: "v1",
        folder: { path: "F1", recursive: true },
      }),
    ).not.toThrow();
    // Discovery's random pick draws its ids from the same pinned slice.
    const random = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT f.id ${fromFor({ folder: { path: "F1", recursive: true } })}
            WHERE f.deleted_at IS NULL AND f.rel_path >= 'F1/' AND f.rel_path < 'F10'`,
        )
        .all() as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(random).toContain("idx_files_alive_rel_path");
    expect(fromFor({ folder: { path: "", recursive: true } })).not.toContain(
      "INDEXED BY",
    );
    const picked = randomFiles(db, {
      folder: { path: "F1", recursive: true },
      limit: 50,
    });
    expect(picked.length).toBe(10);
    expect(picked.every((r) => r.relPath.startsWith(rel("F1/")))).toBe(true);
    // The real queries prepare with the pin too (INDEXED BY fails loudly if
    // the index cannot serve them).
    expect(() => listFolders(db, "F1")).not.toThrow();
    expect(() => listFolders(db, "")).not.toThrow();
    expect(() => folderFiles(db, ["F1", ""], { limit: 10 })).not.toThrow();
    db.close();
  });
});
