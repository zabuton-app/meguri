// Regression tests for the catalog-level tag operations backing the tag screen.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { deleteTags, listTags, mergeTags, renameTag } from "../tagAdmin.js";
import { addFileTag, addManualTag, syncFts, upsertTag } from "../tags.js";
import { searchFiles } from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

const manual = (name: string) => ({ namespace: "", name });

describe("listTags", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("counts distinct alive files and breaks them down by source", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    addManualTag(db, a, "beach");
    addManualTag(db, b, "beach");
    const res4k = upsertTag(db, "res", "4k");
    addFileTag(db, a, res4k, "auto-meta", null);

    const rows = listTags(db);
    const beach = rows.find((r) => r.name === "beach");
    expect(beach).toMatchObject({
      namespace: "",
      fileCount: 2,
      bySource: [{ source: "manual", count: 2 }],
    });
    expect(rows.find((r) => r.namespace === "res")).toMatchObject({
      name: "4k",
      fileCount: 1,
      bySource: [{ source: "auto-meta", count: 1 }],
    });
  });

  it("counts a file once in the total even when two sources attached the tag", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const tag = addManualTag(db, a, "beach");
    addFileTag(db, a, tag, "plugin", null);

    const beach = listTags(db).find((r) => r.name === "beach");
    expect(beach?.fileCount).toBe(1);
    expect(beach?.bySource).toEqual([
      { source: "manual", count: 1 },
      { source: "plugin", count: 1 },
    ]);
  });

  it("excludes soft-deleted files from the counts", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    addManualTag(db, a, "beach");
    addManualTag(db, b, "beach");
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(b);

    expect(listTags(db).find((r) => r.name === "beach")?.fileCount).toBe(1);
  });

  it("omits tags with no remaining assignment", () => {
    upsertTag(db, "", "orphan");
    expect(listTags(db).some((r) => r.name === "orphan")).toBe(false);
  });
});

describe("tag catalog mutations", () => {
  let db: DB;
  let rootId: number;
  let a: number;
  let b: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    a = insertFile(db, rootId, { relPath: "a.mp4" });
    b = insertFile(db, rootId, { relPath: "b.mp4" });
  });
  afterEach(() => db.close());

  /** Attach a manual tag and index the file, so FTS assertions are meaningful. */
  function tag(fileId: number, name: string): void {
    addManualTag(db, fileId, name);
    syncFts(db, fileId);
  }

  function found(q: string): number[] {
    return searchFiles(db, { q }).items.map((f) => f.id);
  }

  function names(): string[] {
    return listTags(db)
      .map((r) => r.name)
      .sort();
  }

  describe("renameTag", () => {
    it("renames in place and re-indexes the affected files", () => {
      tag(a, "hoiday");
      tag(b, "hoiday");

      expect(renameTag(db, manual("hoiday"), "holiday")).toEqual({
        merged: false,
        affectedFiles: 2,
      });
      expect(names()).toEqual(["holiday"]);
      expect(found("hoiday")).toEqual([]);
      expect(found("holiday").sort()).toEqual([a, b].sort());
    });

    it("escalates to a merge when the target name already exists", () => {
      tag(a, "hoiday");
      tag(b, "holiday");

      const res = renameTag(db, manual("hoiday"), "holiday");
      expect(res.merged).toBe(true);
      expect(names()).toEqual(["holiday"]);
      // The union of both tags now carries the surviving name.
      expect(found("holiday").sort()).toEqual([a, b].sort());
    });

    it("is a no-op for an unknown tag or a rename to the same name", () => {
      tag(a, "beach");
      expect(renameTag(db, manual("nope"), "x")).toEqual({
        merged: false,
        affectedFiles: 0,
      });
      expect(renameTag(db, manual("beach"), "beach")).toEqual({
        merged: false,
        affectedFiles: 0,
      });
      expect(names()).toEqual(["beach"]);
    });

    it("trims the new name and rejects an empty or reserved one", () => {
      tag(a, "beach");
      renameTag(db, manual("beach"), "  shore  ");
      expect(names()).toEqual(["shore"]);
      expect(() => renameTag(db, manual("shore"), "   ")).toThrow();
      expect(() => renameTag(db, manual("shore"), "res:4k")).toThrow(
        /reserved/,
      );
    });

    it("refuses to touch a pipeline-owned tag", () => {
      addFileTag(db, a, upsertTag(db, "res", "4k"), "auto-meta", null);
      expect(() =>
        renameTag(db, { namespace: "res", name: "4k" }, "uhd"),
      ).toThrow(/pipeline-owned/);
    });
  });

  describe("mergeTags", () => {
    it("folds several tags into one and re-indexes", () => {
      tag(a, "sea");
      tag(b, "ocean");
      const c = insertFile(db, rootId, { relPath: "c.mp4" });
      tag(c, "beach");

      expect(
        mergeTags(db, [manual("sea"), manual("ocean")], manual("beach")),
      ).toEqual({ affectedFiles: 2 });
      expect(names()).toEqual(["beach"]);
      expect(found("beach").sort()).toEqual([a, b, c].sort());
      expect(found("ocean")).toEqual([]);
    });

    it("keeps per-source rows and the target's score on a collision", () => {
      const keep = addManualTag(db, a, "keep");
      const drop = addManualTag(db, a, "drop");
      // Same file, same source, both tags — the merge must collapse them to one row.
      db.prepare(
        "UPDATE meta_tags SET score = ? WHERE tag_id = ? AND source = 'manual'",
      ).run(0.9, keep);
      db.prepare(
        "UPDATE meta_tags SET score = ? WHERE tag_id = ? AND source = 'manual'",
      ).run(0.1, drop);
      // A second source on the losing tag must survive the move.
      addFileTag(db, a, drop, "plugin", 0.5);

      mergeTags(db, [manual("drop")], manual("keep"));

      const rows = db
        .prepare(
          "SELECT source, score FROM meta_tags WHERE tag_id = ? ORDER BY source",
        )
        .all(keep) as { source: string; score: number | null }[];
      expect(rows).toEqual([
        { source: "manual", score: 0.9 },
        { source: "plugin", score: 0.5 },
      ]);
      expect(names()).toEqual(["keep"]);
    });

    it("ignores the target appearing in the source list", () => {
      tag(a, "beach");
      tag(b, "sea");
      expect(
        mergeTags(db, [manual("beach"), manual("sea")], manual("beach")),
      ).toEqual({ affectedFiles: 1 });
      expect(names()).toEqual(["beach"]);
    });

    it("refuses a target name that impersonates a generated namespace", () => {
      tag(a, "beach");
      // The UI blocks this, but merge would otherwise be a back door around the
      // check addManualTag and renameTag both apply.
      expect(() => mergeTags(db, [manual("beach")], manual("res:4k"))).toThrow(
        /reserved/,
      );
      expect(() => mergeTags(db, [manual("beach")], manual("meta:4k"))).toThrow(
        /reserved/,
      );
    });

    it("refuses to touch a pipeline-owned tag on either side", () => {
      addFileTag(db, a, upsertTag(db, "res", "4k"), "auto-meta", null);
      tag(b, "beach");
      expect(() =>
        mergeTags(db, [{ namespace: "res", name: "4k" }], manual("beach")),
      ).toThrow(/pipeline-owned/);
      expect(() =>
        mergeTags(db, [manual("beach")], { namespace: "res", name: "4k" }),
      ).toThrow(/pipeline-owned/);
    });
  });

  describe("deleteTags", () => {
    it("removes the tag from every file and from the search index", () => {
      tag(a, "beach");
      tag(b, "beach");
      tag(b, "sea");

      expect(deleteTags(db, [manual("beach")])).toEqual({
        removedTags: 1,
        affectedFiles: 2,
      });
      expect(names()).toEqual(["sea"]);
      expect(found("beach")).toEqual([]);
      expect(found("sea")).toEqual([b]);
      // ON DELETE CASCADE cleared the assignments too.
      const n = (
        db.prepare("SELECT COUNT(*) AS n FROM meta_tags").get() as { n: number }
      ).n;
      expect(n).toBe(1);
    });

    it("ignores unknown tags", () => {
      tag(a, "beach");
      expect(deleteTags(db, [manual("nope")])).toEqual({
        removedTags: 0,
        affectedFiles: 0,
      });
      expect(names()).toEqual(["beach"]);
    });

    it("refuses to touch a pipeline-owned tag", () => {
      addFileTag(db, a, upsertTag(db, "res", "4k"), "auto-meta", null);
      expect(() => deleteTags(db, [{ namespace: "res", name: "4k" }])).toThrow(
        /pipeline-owned/,
      );
    });
  });
});
