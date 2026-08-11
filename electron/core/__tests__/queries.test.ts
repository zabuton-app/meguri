// Regression tests for search/filter/sort and durable-metadata operations in queries.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { addFileTag, addManualTag, syncFts, upsertTag } from "../tags.js";
import {
  addBookmark,
  deleteFromIndex,
  fileDetail,
  filesByIds,
  listBookmarks,
  migrateMetaKey,
  pruneOrphanMeta,
  randomFiles,
  removeBookmark,
  searchFiles,
  setFavorite,
  setRating,
  setThumbOffset,
  thumbOffsetOf,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("searchFiles", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("excludes soft-deleted files and paginates with a nextCursor", () => {
    for (let i = 0; i < 3; i++)
      insertFile(db, rootId, { relPath: `v${i}.mp4` });
    const page = searchFiles(db, { limit: 2 });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBe(2);

    const id = insertFile(db, rootId, { relPath: "gone.mp4" });
    deleteFromIndex(db, id);
    const all = searchFiles(db, { limit: 100 });
    expect(all.items.some((f) => f.relPath === "gone.mp4")).toBe(false);
    expect(all.nextCursor).toBeNull();
  });

  it("filters by kind, favorite, and minimum rating", () => {
    const vid = insertFile(db, rootId, { relPath: "a.mp4", kind: "video" });
    const img = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    setFavorite(db, vid, true);
    setRating(db, img, 4);

    expect(searchFiles(db, { kind: "image" }).items.map((f) => f.id)).toEqual([
      img,
    ]);
    expect(searchFiles(db, { favorite: true }).items.map((f) => f.id)).toEqual([
      vid,
    ]);
    expect(searchFiles(db, { ratingMin: 3 }).items.map((f) => f.id)).toEqual([
      img,
    ]);
  });

  it("filters by btime range; files without btime never match", () => {
    const old = insertFile(db, rootId, { relPath: "old.mp4", btime: 100 });
    const mid = insertFile(db, rootId, { relPath: "mid.mp4", btime: 200 });
    const recent = insertFile(db, rootId, { relPath: "new.mp4", btime: 300 });
    insertFile(db, rootId, { relPath: "nobtime.mp4", btime: null });

    const ids = (q: Parameters<typeof searchFiles>[1]) =>
      searchFiles(db, q)
        .items.map((f) => f.id)
        .sort();
    expect(ids({ btimeFrom: 150 })).toEqual([mid, recent].sort());
    expect(ids({ btimeTo: 250 })).toEqual([old, mid].sort());
    expect(ids({ btimeFrom: 150, btimeTo: 250 })).toEqual([mid]);
    expect(ids({ btimeFrom: 400 })).toEqual([]);
  });

  it("filters by fileIds (collection membership)", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    insertFile(db, rootId, { relPath: "b.mp4" });
    const c = insertFile(db, rootId, { relPath: "c.mp4" });
    const ids = searchFiles(db, { fileIds: [a, c], sort: "name" }).items.map(
      (f) => f.id,
    );
    expect(ids.sort((x, y) => x - y)).toEqual([a, c].sort((x, y) => x - y));
    // Empty IN set must match nothing rather than everything.
    expect(searchFiles(db, { fileIds: [-1] }).items).toEqual([]);
  });

  it("handles a fileIds set larger than SQLite's bound-variable limit", () => {
    const id = insertFile(db, rootId, { relPath: "needle.mp4" });
    // 40k synthetic IDs would exceed SQLITE_MAX_VARIABLE_NUMBER if expanded to one
    // placeholder each; json_each binds them as a single parameter instead.
    const haystack = Array.from({ length: 40000 }, (_, i) => i + 1000);
    const res = searchFiles(db, { fileIds: [id, ...haystack] });
    expect(res.items.map((f) => f.id)).toEqual([id]);
  });

  it("orders by name and by rating", () => {
    const c = insertFile(db, rootId, { relPath: "c.mp4" });
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    expect(
      searchFiles(db, { sort: "name" }).items.map((f) => f.relPath),
    ).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
    setRating(db, c, 5);
    setRating(db, a, 1);
    expect(searchFiles(db, { sort: "rating" }).items[0].id).toBe(c);
    void [a, b];
  });

  it("supports explicit ascending and descending sort directions", () => {
    const c = insertFile(db, rootId, { relPath: "c.mp4", capturedAt: 30 });
    const a = insertFile(db, rootId, { relPath: "a.mp4", capturedAt: 10 });
    const b = insertFile(db, rootId, { relPath: "b.mp4", capturedAt: null });
    setRating(db, c, 5);
    setRating(db, a, 1);
    setRating(db, b, 3);

    expect(
      searchFiles(db, { sort: "name", sortDir: "desc" }).items.map(
        (f) => f.relPath,
      ),
    ).toEqual(["c.mp4", "b.mp4", "a.mp4"]);
    expect(
      searchFiles(db, { sort: "rating", sortDir: "asc" }).items.map(
        (f) => f.id,
      ),
    ).toEqual([a, b, c]);
    expect(
      searchFiles(db, { sort: "captured", sortDir: "asc" }).items.map(
        (f) => f.id,
      ),
    ).toEqual([a, c, b]);
  });

  it("sorts by btime in both directions with NULLs last", () => {
    const mid = insertFile(db, rootId, { relPath: "mid.mp4", btime: 200 });
    const old = insertFile(db, rootId, { relPath: "old.mp4", btime: 100 });
    const none = insertFile(db, rootId, { relPath: "none.mp4", btime: null });

    // Default direction is desc (newest first); NULLs sort last either way.
    expect(searchFiles(db, { sort: "btime" }).items.map((f) => f.id)).toEqual([
      mid,
      old,
      none,
    ]);
    expect(
      searchFiles(db, { sort: "btime", sortDir: "asc" }).items.map((f) => f.id),
    ).toEqual([old, mid, none]);
  });

  it("matches the full-text query against rel_path after FTS sync", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    const res = searchFiles(db, { q: "beach" });
    expect(res.items.map((f) => f.id)).toEqual([hit]);
  });

  it("matches a substring in the middle of a word (trigram)", () => {
    const hit = insertFile(db, rootId, { relPath: "summer_beachvideo.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    expect(searchFiles(db, { q: "chvid" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("matches CJK substrings via MATCH (3+ chars) and LIKE (short tokens)", () => {
    const hit = insertFile(db, rootId, { relPath: "夏の海岸ビデオ.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    // 3 codepoints -> trigram MATCH path.
    expect(searchFiles(db, { q: "海岸ビ" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // 2 codepoints -> LIKE fallback path (a trigram MATCH would return zero rows).
    expect(searchFiles(db, { q: "海岸" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // Single codepoint.
    expect(searchFiles(db, { q: "夏" }).items.map((f) => f.id)).toEqual([hit]);
  });

  it("ANDs long and short tokens together", () => {
    const both = insertFile(db, rootId, { relPath: "海岸_beach.mp4" });
    const beachOnly = insertFile(db, rootId, { relPath: "city_beach.mp4" });
    syncFts(db, both);
    syncFts(db, beachOnly);
    // "beach" (MATCH) AND "海岸" (LIKE) must both hold.
    expect(searchFiles(db, { q: "beach 海岸" }).items.map((f) => f.id)).toEqual(
      [both],
    );
  });

  it("treats LIKE metacharacters in short tokens literally", () => {
    const percent = insertFile(db, rootId, { relPath: "sale_5%.mp4" });
    const plain = insertFile(db, rootId, { relPath: "sale_55.mp4" });
    syncFts(db, percent);
    syncFts(db, plain);
    // "5%" is 2 codepoints -> LIKE path; unescaped it would also match "55".
    expect(searchFiles(db, { q: "5%" }).items.map((f) => f.id)).toEqual([
      percent,
    ]);
  });

  it("matches case-insensitively through the trigram tokenizer", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    syncFts(db, hit);
    expect(searchFiles(db, { q: "BEACH" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("strips double quotes from query tokens instead of matching them literally", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    // A pasted quoted word must behave like the bare word, not a zero-row
    // search for literal quote characters.
    expect(searchFiles(db, { q: '"beach"' }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // A token that is only quotes vanishes; the remaining token still applies.
    expect(searchFiles(db, { q: '" beach' }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("clamps an out-of-range rating into 0..5", () => {
    const id = insertFile(db, rootId, { relPath: "r.mp4" });
    setRating(db, id, 99);
    expect(filesByIds(db, [id])[0].rating).toBe(5);
    setRating(db, id, -3);
    expect(filesByIds(db, [id])[0].rating).toBe(0);
  });
});

describe("randomFiles", () => {
  it("respects query filters and the limit", () => {
    const { db, rootId } = newDb();
    for (let i = 0; i < 5; i++)
      insertFile(db, rootId, { relPath: `v${i}.mp4`, kind: "video" });
    insertFile(db, rootId, { relPath: "p.jpg", kind: "image" });
    const out = randomFiles(db, { kind: "video", limit: 3 });
    expect(out.length).toBe(3);
    expect(out.every((f) => f.kind === "video")).toBe(true);
    db.close();
  });
});

describe("attachTags", () => {
  it("omits pipeline sources from list rows but keeps them on the detail", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addManualTag(db, id, "beach");
    addFileTag(db, id, upsertTag(db, "res", "4k"), "auto-meta", null);

    // A list row never draws generated tags, so shipping four of them per file
    // across the process boundary would be paid for nothing.
    const row = searchFiles(db, {}).items[0];
    expect(row.tags?.map((t) => t.name)).toEqual(["beach"]);
    // The detail pane does show them.
    expect(
      fileDetail(db, id)
        ?.tags.map((t) => `${t.namespace}:${t.name}`)
        .sort(),
    ).toEqual([":beach", "res:4k"]);
    db.close();
  });
});

describe("structured tag filtering", () => {
  let db: DB;
  let rootId: number;
  let manualOnly: number;
  let autoOnly: number;
  let both: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    manualOnly = insertFile(db, rootId, { relPath: "manual.mp4" });
    autoOnly = insertFile(db, rootId, { relPath: "auto.mp4" });
    both = insertFile(db, rootId, { relPath: "both.mp4" });
    addManualTag(db, manualOnly, "beach");
    addManualTag(db, both, "beach");
    const res4k = upsertTag(db, "res", "4k");
    addFileTag(db, autoOnly, res4k, "auto-meta", null);
    addFileTag(db, both, res4k, "auto-meta", null);
  });
  afterEach(() => db.close());

  function ids(tags: string[], tagSource?: string): number[] {
    return searchFiles(db, { tags, tagSource })
      .items.map((f) => f.id)
      .sort((a, b) => a - b);
  }

  it("matches a namespaced tag by its qualified name", () => {
    expect(ids(["res:4k"])).toEqual([autoOnly, both].sort((a, b) => a - b));
  });

  it("does not confuse a manual tag with the value half of a namespaced one", () => {
    const plain4k = insertFile(db, rootId, { relPath: "plain.mp4" });
    addManualTag(db, plain4k, "4k");
    // The bare token only resolves against namespace = ''.
    expect(ids(["4k"])).toEqual([plain4k]);
  });

  it("matches a manual tag whose own name contains a colon", () => {
    const id = insertFile(db, rootId, { relPath: "todo.mp4" });
    addManualTag(db, id, "todo:later");
    expect(ids(["todo:later"])).toEqual([id]);
  });

  it("resolves a namespace it has never heard of, straight from the tags table", () => {
    const id = insertFile(db, rootId, { relPath: "studio.mp4" });
    // "studio" is not in AUTO_META_NAMESPACES — matching must not depend on that list.
    addFileTag(db, id, upsertTag(db, "studio", "a24"), "auto-name", null);
    expect(ids(["studio:a24"])).toEqual([id]);
  });

  it("returns nothing for a tag that does not exist", () => {
    expect(ids(["nope"])).toEqual([]);
    expect(ids(["res:8k"])).toEqual([]);
  });

  it("combines multiple tags with AND", () => {
    expect(ids(["beach", "res:4k"])).toEqual([both]);
  });

  it("still honours tagSource across every token", () => {
    expect(ids(["res:4k"], "auto-meta")).toEqual(
      [autoOnly, both].sort((a, b) => a - b),
    );
    expect(ids(["res:4k"], "manual")).toEqual([]);
  });

  describe("the tag: free-text directive", () => {
    function q(text: string): number[] {
      return searchFiles(db, { q: text })
        .items.map((f) => f.id)
        .sort((a, b) => a - b);
    }

    it("matches a manual tag exactly, unlike the bare word", () => {
      const named = insertFile(db, rootId, { relPath: "beach-holiday.mp4" });
      syncFts(db, named);
      // The whole point of the directive: putting the condition in the search
      // box must not degrade it into a substring search over file names.
      expect(q("beach")).toContain(named);
      expect(q("tag:beach")).not.toContain(named);
      expect(q("tag:beach")).toEqual([manualOnly, both].sort((a, b) => a - b));
    });

    it("reaches a generated tag by its bare value", () => {
      // One directive covers both kinds: the user does not think of "my tags"
      // and "the scanner's tags" as separate things to search.
      expect(q("tag:4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("reaches a generated tag by its qualified form", () => {
      expect(q("tag:res:4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("matches both kinds when a bare value names each", () => {
      // A manual "4k" alongside the generated res:4k. Either is what a person
      // means by tag:4k; the qualified form narrows it back down.
      const plain = insertFile(db, rootId, { relPath: "plain.mp4" });
      addManualTag(db, plain, "4k");
      syncFts(db, plain);
      expect(q("tag:4k")).toContain(plain);
      expect(q("tag:res:4k")).not.toContain(plain);
    });

    it("is case-insensitive on both the prefix and the value", () => {
      // The FTS half of the box is case-insensitive; an arbitrary split here
      // would just look broken.
      expect(q("TAG:BEACH")).toEqual([manualOnly, both].sort((a, b) => a - b));
      const expected = [autoOnly, both].sort((a, b) => a - b);
      expect(q("tag:4K")).toEqual(expected);
      expect(q("tag:RES:4K")).toEqual(expected);
    });

    it("returns nothing for an unknown value", () => {
      expect(q("tag:8k")).toEqual([]);
    });

    it("combines two directives and free text", () => {
      expect(q("tag:beach tag:4k")).toEqual([both]);
      syncFts(db, autoOnly);
      syncFts(db, both);
      // "auto" only appears in auto.mp4's path, so the pair narrows to one file.
      expect(q("auto tag:4k")).toEqual([autoOnly]);
    });

    it("leaves a bare `tag:` as ordinary text", () => {
      expect(q("tag:")).toEqual([]);
    });

    it("tolerates a space after the colon", () => {
      // What a person types. The search box shows the same chip either way, so
      // the SQL has to agree — a mismatch would be invisible to the user.
      expect(q("tag: beach")).toEqual([manualOnly, both].sort((a, b) => a - b));
      expect(q("tag: 4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("keeps a quoted multi-word tag together", () => {
      const id = insertFile(db, rootId, { relPath: "spaced.mp4" });
      addManualTag(db, id, "beach house");
      expect(q('tag:"beach house"')).toEqual([id]);
      // Unquoted, the space splits it into two ordinary conditions.
      expect(q("tag:beach house")).not.toContain(id);
    });

    it("returns nothing for an unknown tag", () => {
      expect(q("tag:nope")).toEqual([]);
    });
  });

  it("does not match on the file name the way free text does", () => {
    const named = insertFile(db, rootId, { relPath: "beach-holiday.mp4" });
    syncFts(db, named);
    expect(searchFiles(db, { q: "beach" }).items.map((f) => f.id)).toContain(
      named,
    );
    expect(ids(["beach"])).not.toContain(named);
  });
});

describe("deleteFromIndex", () => {
  it("soft-deletes, excludes, drops the FTS row, and rejects a second delete", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "del.mp4" });
    syncFts(db, id);
    const res = deleteFromIndex(db, id);
    expect(res).toEqual({ id, relPath: "del.mp4" });

    const row = db
      .prepare("SELECT deleted_at, excluded_at FROM files WHERE id = ?")
      .get(id) as { deleted_at: number | null; excluded_at: number | null };
    expect(row.deleted_at).not.toBeNull();
    expect(row.excluded_at).not.toBeNull();
    expect(
      db.prepare("SELECT rowid FROM files_fts WHERE rowid = ?").get(id),
    ).toBeUndefined();

    expect(() => deleteFromIndex(db, id)).toThrow();
    db.close();
  });
});

describe("durable metadata keyed by meta_key", () => {
  it("survives a content_hash appearing: migrateMetaKey carries favorite/rating over", () => {
    const { db, rootId } = newDb();
    // File with no hash yet -> meta_key falls back to "p:<rootId>:<relPath>".
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    setFavorite(db, id, true);
    setRating(db, id, 5);
    const fromKey = `p:${rootId}:m.mp4`;
    const toKey = "abc123hash";

    migrateMetaKey(db, fromKey, toKey);
    // Point the file row at the new hash-based key and confirm the metadata followed.
    db.prepare("UPDATE files SET content_hash = ? WHERE id = ?").run(toKey, id);
    const row = filesByIds(db, [id])[0];
    expect(row.favorite).toBe(1);
    expect(row.rating).toBe(5);
    db.close();
  });

  it("pruneOrphanMeta drops metadata with no file row but keeps soft-deleted files' metadata", () => {
    const { db, rootId } = newDb();
    const kept = insertFile(db, rootId, {
      relPath: "kept.mp4",
      contentHash: "keephash",
    });
    setFavorite(db, kept, true);
    deleteFromIndex(db, kept); // soft delete: row remains, so its meta_key is still referenced

    // An orphan meta row whose key maps to no files row at all.
    db.prepare(
      "INSERT INTO file_meta (meta_key, favorite, updated_at) VALUES ('orphan', 1, 0)",
    ).run();

    pruneOrphanMeta(db);

    expect(
      db.prepare("SELECT 1 FROM file_meta WHERE meta_key = 'orphan'").get(),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT 1 FROM file_meta WHERE meta_key = 'keephash'").get(),
    ).toBeDefined();
    db.close();
  });
});

describe("scene bookmarks", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("addBookmark inserts and listBookmarks returns rows ordered by sec", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addBookmark(db, id, 30);
    addBookmark(db, id, 10);
    addBookmark(db, id, 20);
    const rows = listBookmarks(db, id);
    expect(rows.map((r) => r.sec)).toEqual([10, 20, 30]);
  });

  it("addBookmark dedupes within ±2 seconds and returns the existing row", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    const first = addBookmark(db, id, 10);
    const near = addBookmark(db, id, 11.5);
    expect(near?.id).toBe(first?.id);
    expect(listBookmarks(db, id).length).toBe(1);
  });

  it("addBookmark rejects non-finite values", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    expect(addBookmark(db, id, Number.NaN)).toBeNull();
    expect(addBookmark(db, id, Number.POSITIVE_INFINITY)).toBeNull();
    expect(listBookmarks(db, id).length).toBe(0);
  });

  it("removeBookmark only deletes bookmarks owned by the same file", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "ha" });
    const b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "hb" });
    const aBm = addBookmark(db, a, 5)!;
    const bBm = addBookmark(db, b, 5)!;
    // Try to remove file-a's bookmark via file-b's id — should be a no-op.
    removeBookmark(db, b, aBm.id);
    expect(listBookmarks(db, a).map((r) => r.id)).toEqual([aBm.id]);
    expect(listBookmarks(db, b).map((r) => r.id)).toEqual([bBm.id]);
  });

  it("migrateMetaKey carries bookmarks along when a content_hash first appears", () => {
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    addBookmark(db, id, 42);
    migrateMetaKey(db, `p:${rootId}:m.mp4`, "hashed");
    db.prepare("UPDATE files SET content_hash = ? WHERE id = ?").run(
      "hashed",
      id,
    );
    const rows = listBookmarks(db, id);
    expect(rows.map((r) => r.sec)).toEqual([42]);
  });
});

describe("custom thumbnail offset (file_meta.thumb_offset_sec)", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("round-trips a numeric offset and exposes it on fileDetail", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4", duration: 300 });
    setThumbOffset(db, id, 12.5);
    expect(thumbOffsetOf(db, id)).toBe(12.5);
    expect(fileDetail(db, id)?.thumbOffsetSec).toBe(12.5);
  });

  it("clears back to null when set with null", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4" });
    setThumbOffset(db, id, 7);
    setThumbOffset(db, id, null);
    expect(thumbOffsetOf(db, id)).toBeNull();
    expect(fileDetail(db, id)?.thumbOffsetSec).toBeNull();
  });

  it("rejects negative and non-finite values (stores null instead)", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4" });
    setThumbOffset(db, id, -1);
    expect(thumbOffsetOf(db, id)).toBeNull();
    setThumbOffset(db, id, Number.NaN);
    expect(thumbOffsetOf(db, id)).toBeNull();
  });
});
