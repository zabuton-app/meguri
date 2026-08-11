// Regression tests for tag operations and FTS sync in tags.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  addFileTag,
  addManualTag,
  fileTags,
  listTagNames,
  removeManualTag,
  syncFts,
  tagsText,
  upsertTag,
} from "../tags.js";
import { searchFiles } from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("tags", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("upsertTag is idempotent per (namespace, name)", () => {
    const a = upsertTag(db, "", "sunset");
    const b = upsertTag(db, "", "sunset");
    expect(b).toBe(a);
    const count = (
      db.prepare("SELECT COUNT(*) c FROM tags").get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("adds and removes a manual tag for a file", () => {
    const id = insertFile(db, rootId, { relPath: "t.mp4", contentHash: "h1" });
    const tagId = addManualTag(db, id, "beach");
    expect(fileTags(db, id).map((t) => t.name)).toEqual(["beach"]);
    expect(tagsText(db, id)).toBe("beach");

    removeManualTag(db, id, tagId);
    expect(fileTags(db, id)).toEqual([]);
  });

  it("keeps tags addressable by meta_key so they survive id changes", () => {
    const id = insertFile(db, rootId, {
      relPath: "k.mp4",
      contentHash: "stable-hash",
    });
    addManualTag(db, id, "keep");
    // Tags are stored against meta_key (the content_hash), not files.id.
    const row = db
      .prepare("SELECT meta_key FROM files WHERE id = ?")
      .get(id) as {
      meta_key: string;
    };
    expect(row.meta_key).toBe("stable-hash");
    const linked = db
      .prepare("SELECT COUNT(*) c FROM meta_tags WHERE meta_key = ?")
      .get("stable-hash") as { c: number };
    expect(linked.c).toBe(1);
  });

  it("syncFts makes a tag searchable and removing it drops the match", () => {
    const id = insertFile(db, rootId, {
      relPath: "video.mp4",
      contentHash: "h2",
    });
    const tagId = addManualTag(db, id, "vacation");
    syncFts(db, id);
    expect(searchFiles(db, { q: "vacation" }).items.map((f) => f.id)).toEqual([
      id,
    ]);

    removeManualTag(db, id, tagId);
    syncFts(db, id);
    expect(searchFiles(db, { q: "vacation" }).items).toEqual([]);
  });

  it("listTagNames matches by prefix and escapes LIKE wildcards", () => {
    upsertTag(db, "", "a_b");
    upsertTag(db, "", "axb");
    upsertTag(db, "", "abc");
    // "_" is a LIKE wildcard; it must be escaped so the prefix is treated literally.
    expect(listTagNames(db, "a_", 10)).toEqual(["a_b"]);
    expect(listTagNames(db, "a", 10).sort()).toEqual(["a_b", "abc", "axb"]);
  });

  it("listTagNames never offers pipeline-owned (namespaced) tags", () => {
    upsertTag(db, "", "4k-remaster");
    upsertTag(db, "res", "4k");
    expect(listTagNames(db, "4k", 10)).toEqual(["4k-remaster"]);
  });

  it("tagsText carries only user-owned tags, deduplicated across sources", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addManualTag(db, id, "beach");
    const manual = upsertTag(db, "", "beach");
    // Same tag from a second source must not be repeated in the search text.
    addFileTag(db, id, manual, "plugin", null);
    // A generated tag stays out: with a trigram tokenizer, indexing "dur:long"
    // would make a plain search for "long" return every long video.
    addFileTag(db, id, upsertTag(db, "dur", "long"), "auto-meta", null);
    expect(tagsText(db, id)).toBe("beach");
  });

  it("keeps generated tags out of free-text results", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addFileTag(db, id, upsertTag(db, "dur", "long"), "auto-meta", null);
    syncFts(db, id);
    expect(searchFiles(db, { q: "long" }).items).toEqual([]);
  });

  it("addManualTag rejects a name impersonating a pipeline namespace", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    expect(() => addManualTag(db, id, "res:4k")).toThrow(/reserved/);
    // A colon that is not a known namespace stays a perfectly ordinary tag name.
    expect(() => addManualTag(db, id, "todo:later")).not.toThrow();
    expect(fileTags(db, id).map((t) => t.name)).toEqual(["todo:later"]);
  });
});
