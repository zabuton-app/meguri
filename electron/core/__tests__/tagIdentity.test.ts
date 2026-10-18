// One rule for when two tag names are one tag (tagIdentityKey), checked on each
// path that matches a name to a tag already there: adding by hand, the bulk
// editor, rename, and the `tag:` search. Spellings: ASCII, beyond ASCII, mixed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, openDbReadonly, type DB } from "../db.js";
import { attachAutoTags } from "../autoTag.js";
import { renameTag } from "../tagAdmin.js";
import {
  addManualTag,
  bulkEditManualTags,
  fileTags,
  findManualTag,
  syncFts,
  upsertTag,
} from "../tags.js";
import { searchFiles } from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

const manual = (name: string) => ({ namespace: "", name });

describe("tag identity", () => {
  let db: DB;
  let rootId: number;
  let a: number;
  let b: number;

  beforeEach(() => {
    ({ db, rootId } = newDb());
    a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "ha" });
    b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "hb" });
  });
  afterEach(() => db.close());

  const ownTags = () =>
    (
      db
        .prepare("SELECT name FROM tags WHERE namespace = '' ORDER BY id")
        .pluck()
        .all() as string[]
    ).slice();
  const namesOf = (id: number) => fileTags(db, id).map((t) => t.name);
  const found = (q: string) =>
    searchFiles(db, { q })
      .items.map((f) => f.id)
      .sort();

  describe("adding by hand", () => {
    it.each([
      ["ASCII", "trip", "Trip"],
      ["beyond ASCII", "été", "ÉTÉ"],
      ["mixed", "Été trip", "éTÉ TRIP"],
    ])("reuses the tag already there (%s)", (_, have, typed) => {
      const id = addManualTag(db, a, have);
      expect(addManualTag(db, b, typed)).toBe(id);
      expect(ownTags()).toEqual([have]);
      expect(namesOf(b)).toEqual([have]);
    });

    it("creates the tag in the spelling typed when there is none", () => {
      addManualTag(db, a, "Été");
      expect(ownTags()).toEqual(["Été"]);
    });

    it("of two spellings a library holds, lands on the exact one, else the older", () => {
      // From before the rule: two rows, which stay as they are.
      const older = upsertTag(db, "", "Trip");
      const newer = upsertTag(db, "", "trip");
      expect(addManualTag(db, a, "TRIP")).toBe(older);
      expect(addManualTag(db, b, "trip")).toBe(newer);
      expect(ownTags()).toEqual(["Trip", "trip"]);
    });

    it("picks the tag auto tagging would for every spelling", () => {
      upsertTag(db, "", "Trip");
      upsertTag(db, "", "trip");
      upsertTag(db, "", "Été");
      // The engine's resolver (attachAutoTags) and findManualTag decide alone.
      ["Trip", "trip", "TRIP", "été", "Été"].forEach((name, i) => {
        const id = insertFile(db, rootId, {
          relPath: `spelling${i}.mp4`,
          contentHash: `hs${i}`,
        });
        attachAutoTags(db, [{ fileIds: [id], tags: [name] }]);
        expect(fileTags(db, id).map((t) => t.id)).toEqual([
          findManualTag(db, name),
        ]);
      });
    });

    it("never resolves to a generated tag", () => {
      upsertTag(db, "res", "4K");
      addManualTag(db, a, "4k");
      expect(findManualTag(db, "4K")).not.toBeNull();
      expect(namesOf(a)).toEqual(["4k"]);
    });
  });

  describe("the bulk editor", () => {
    it("adds to the tag already there under another spelling", () => {
      addManualTag(db, a, "été");
      const r = bulkEditManualTags(db, [a, b], ["ÉTÉ"], []);
      expect(r).toEqual({ files: 1, skipped: 0, added: 1, removed: 0 });
      expect(ownTags()).toEqual(["été"]);
      expect(namesOf(b)).toEqual(["été"]);
    });

    it("adds two spellings of one name once", () => {
      const r = bulkEditManualTags(db, [a], ["Trip", "trip"], []);
      expect(r.added).toBe(1);
      expect(ownTags()).toEqual(["Trip"]);
    });

    it("removes the spelling named, not another one", () => {
      const trip = upsertTag(db, "", "Trip");
      upsertTag(db, "", "trip");
      bulkEditManualTags(db, [a], ["Trip"], []);
      db.prepare(
        "INSERT INTO meta_tags (meta_key, tag_id, source) SELECT meta_key, (SELECT id FROM tags WHERE name = 'trip'), 'manual' FROM files WHERE id = ?",
      ).run(a);
      bulkEditManualTags(db, [a], [], ["trip"]);
      expect(fileTags(db, a).map((t) => t.id)).toEqual([trip]);
    });

    it("moves files from one spelling a library holds to the other", () => {
      // `trip` is the older row; `Trip` is asked for exactly.
      const trip = upsertTag(db, "", "trip");
      const Trip = upsertTag(db, "", "Trip");
      bulkEditManualTags(db, [a], ["trip"], []);
      const r = bulkEditManualTags(db, [a, b], ["Trip"], ["trip"]);
      expect(r).toEqual({ files: 2, skipped: 0, added: 2, removed: 1 });
      expect(fileTags(db, a).map((t) => t.id)).toEqual([Trip]);
      expect(fileTags(db, b).map((t) => t.id)).toEqual([Trip]);
      expect(trip).not.toBe(Trip);
    });

    it("keeps a tag both lists name under different spellings", () => {
      addManualTag(db, a, "trip");
      const r = bulkEditManualTags(db, [a], ["TRIP"], ["trip"]);
      expect(r).toEqual({ files: 0, skipped: 0, added: 0, removed: 0 });
      expect(namesOf(a)).toEqual(["trip"]);
    });
  });

  describe("rename", () => {
    it("only respells a tag when no other one has the name", () => {
      addManualTag(db, a, "trip");
      expect(renameTag(db, manual("trip"), "Trip")).toEqual({
        merged: false,
        affectedFiles: 1,
      });
      expect(ownTags()).toEqual(["Trip"]);
    });

    it("merges into the tag the new name means, in that tag's spelling", () => {
      // What the screen sends: the name as the tag it collided with spells it.
      addManualTag(db, a, "été");
      addManualTag(db, b, "summer");
      const res = renameTag(db, manual("summer"), "été");
      expect(res.merged).toBe(true);
      expect(ownTags()).toEqual(["été"]);
      expect(namesOf(b)).toEqual(["été"]);
    });

    it("merges into a tag spelled otherwise and spells the result as asked", () => {
      // Another workspace's spelling, or a tag the screen could not show.
      addManualTag(db, a, "été");
      addManualTag(db, b, "summer");
      const res = renameTag(db, manual("summer"), "ÉTÉ");
      expect(res.merged).toBe(true);
      expect(ownTags()).toEqual(["ÉTÉ"]);
      expect(namesOf(a)).toEqual(["ÉTÉ"]);
      expect(namesOf(b)).toEqual(["ÉTÉ"]);
      syncFts(db, a);
      expect(found("ÉTÉ")).toEqual([a, b].sort());
    });

    it("merges into the exact spelling when it is the newer row", () => {
      upsertTag(db, "", "trip");
      const Trip = upsertTag(db, "", "Trip");
      addManualTag(db, a, "beach");
      renameTag(db, manual("beach"), "Trip");
      expect(fileTags(db, a).map((t) => t.id)).toEqual([Trip]);
      expect(ownTags()).toEqual(["trip", "Trip"]);
    });

    it("merges two spellings a library holds when one is renamed to the other", () => {
      upsertTag(db, "", "Trip");
      addManualTag(db, a, "Trip");
      db.prepare(
        "INSERT INTO tags (namespace, name) VALUES ('', 'trip')",
      ).run();
      db.prepare(
        "INSERT INTO meta_tags (meta_key, tag_id, source) SELECT meta_key, (SELECT id FROM tags WHERE name = 'trip'), 'manual' FROM files WHERE id = ?",
      ).run(b);
      const res = renameTag(db, manual("trip"), "Trip");
      expect(res.merged).toBe(true);
      expect(ownTags()).toEqual(["Trip"]);
      expect(namesOf(b)).toEqual(["Trip"]);
    });
  });

  describe("the tag: search", () => {
    it.each([
      ["ASCII", "Trip", "tag:TRIP"],
      ["beyond ASCII", "été", "tag:ÉTÉ"],
      ["mixed", "Été trip", 'tag:"éTÉ TRIP"'],
    ])("finds the tag in another case (%s)", (_, name, q) => {
      addManualTag(db, a, name);
      syncFts(db, a);
      expect(found(q)).toEqual([a]);
    });

    it("finds a generated tag by its qualified form in another case", () => {
      addManualTag(db, a, "x");
      const id = upsertTag(db, "codec", "hevc");
      db.prepare(
        "INSERT INTO meta_tags (meta_key, tag_id, source) SELECT meta_key, ?, 'auto-meta' FROM files WHERE id = ?",
      ).run(id, b);
      expect(found("tag:CODEC:HEVC")).toEqual([b]);
    });
  });
});

describe("tag_key on a read-only handle", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is registered there too, where the query worker searches", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-tagkey-"));
    const file = path.join(dir, "core.db");
    openDb(file).close();
    const ro = openDbReadonly(file);
    try {
      expect(ro.prepare("SELECT tag_key('ÉTÉ')").pluck().get()).toBe("été");
    } finally {
      ro.close();
    }
  });
});
