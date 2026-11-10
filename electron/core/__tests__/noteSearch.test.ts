// `note:` and `has:note` in the search box: conditions on the file's note in
// the library, not on the full-text index.
import { describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { searchFiles, setNote } from "../queries.js";
import { syncFts } from "../tags.js";
import { joinSearchTokens, splitSearchTokens } from "../../../shared/tags.js";
import { insertFile, newDb } from "./helpers.js";

function names(db: DB, q: string): string[] {
  return searchFiles(db, { q })
    .items.map((f) => f.relPath)
    .sort();
}

function library(): DB {
  const { db, rootId } = newDb();
  const add = (relPath: string, note: string | null) => {
    const id = insertFile(db, rootId, { relPath, contentHash: relPath });
    // Indexed as a scan would, so text in names can be searched beside notes.
    syncFts(db, id);
    setNote(db, id, note);
  };
  add("pexels-5752729.mp4", "Source: https://www.pexels.com/video/5752729/");
  add("beach.mp4", "### Licence\n\nCC0, ÉCOLE shoot");
  add("plain.mp4", null);
  // A note word in a file name must not make the file match `note:`.
  add("pexels-in-name.mp4", null);
  return db;
}

describe("note: search", () => {
  it("finds files whose note contains the text", () => {
    const db = library();
    expect(names(db, "note:pexels")).toEqual(["pexels-5752729.mp4"]);
  });

  it("ignores case for every script, and width", () => {
    const db = library();
    expect(names(db, "note:école")).toEqual(["beach.mp4"]);
    expect(names(db, "note:ＣＣ０")).toEqual(["beach.mp4"]);
  });

  it("takes alternatives, and ANDs separate tokens", () => {
    const db = library();
    expect(names(db, "note:pexels|licence")).toEqual([
      "beach.mp4",
      "pexels-5752729.mp4",
    ]);
    expect(names(db, "note:licence note:cc0")).toEqual(["beach.mp4"]);
    expect(names(db, "note:licence note:pexels")).toEqual([]);
  });

  it("reads a quoted value with spaces, and a space after the colon", () => {
    const db = library();
    expect(names(db, 'note:"école shoot"')).toEqual(["beach.mp4"]);
    expect(names(db, "note: pexels")).toEqual(["pexels-5752729.mp4"]);
  });

  it("combines with text searched in names", () => {
    const db = library();
    expect(names(db, "pexels note:pexels")).toEqual(["pexels-5752729.mp4"]);
    expect(names(db, "beach note:pexels")).toEqual([]);
  });

  it("matches short values too, which the trigram index could not", () => {
    const db = library();
    expect(names(db, "note:cc")).toEqual(["beach.mp4"]);
  });
});

describe("has:note search", () => {
  it("finds files that have a note", () => {
    const db = library();
    expect(names(db, "has:note")).toEqual(["beach.mp4", "pexels-5752729.mp4"]);
    expect(names(db, "HAS:NOTE beach")).toEqual(["beach.mp4"]);
  });

  it("does not count a note that was removed", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "a" });
    setNote(db, id, "x");
    setNote(db, id, null);
    expect(names(db, "has:note")).toEqual([]);
  });

  it("leaves any other has: value as text", () => {
    const db = library();
    expect(names(db, "has:tags")).toEqual([]);
  });
});

describe("note directives in the tokenizer", () => {
  it("does not take a directive typed after an abandoned `note: ` as its value", () => {
    expect(splitSearchTokens("note: tag:beach")).toEqual([
      "note:",
      "tag:beach",
    ]);
    expect(splitSearchTokens("note: has:note")).toEqual(["note:", "has:note"]);
    expect(splitSearchTokens("tag: note:x")).toEqual(["tag:", "note:x"]);
    expect(splitSearchTokens("note: pexels")).toEqual(["note:pexels"]);
  });

  it("quotes only the value when joining", () => {
    expect(joinSearchTokens(["note:école shoot", "has:note"])).toBe(
      'note:"école shoot" has:note',
    );
    expect(splitSearchTokens('note:"école shoot" has:note')).toEqual([
      "note:école shoot",
      "has:note",
    ]);
  });
});
