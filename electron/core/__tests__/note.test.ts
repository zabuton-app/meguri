import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../db.js";
import {
  FILE_META_MERGE_SET,
  fileDetail,
  migrateMetaKey,
  setNote,
  setRating,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

function noteRow(db: DB, metaKey: string): { note: string | null } | undefined {
  return db
    .prepare("SELECT note FROM file_meta WHERE meta_key = ?")
    .get(metaKey) as { note: string | null } | undefined;
}

describe("setNote", () => {
  it("stores the Markdown as given and reads it back through fileDetail", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h" });
    const md = "### Source\n\n- https://example.com/clip\n\n  trailing  ";
    setNote(db, id, md);
    expect(fileDetail(db, id)?.note).toBe(md);
  });

  it("stores whitespace-only text as no note", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h" });
    setNote(db, id, "something");
    setNote(db, id, "  \n\t ");
    expect(noteRow(db, "h")?.note).toBeNull();
    expect(fileDetail(db, id)?.note).toBeNull();
  });

  it("creates no row just to remove a note", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h" });
    setNote(db, id, null);
    expect(noteRow(db, "h")).toBeUndefined();
  });

  it("leaves the other metadata alone", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h" });
    setRating(db, id, 4);
    setNote(db, id, "note");
    setNote(db, id, null);
    expect(fileDetail(db, id)?.rating).toBe(4);
  });

  it("does nothing for a file that is gone", () => {
    const { db } = newDb();
    expect(() => setNote(db, 999, "note")).not.toThrow();
  });
});

describe("merging notes", () => {
  function seedNotes(db: DB, rows: [string, string | null, number][]): void {
    const ins = db.prepare(
      "INSERT INTO file_meta (meta_key, note, updated_at) VALUES (?, ?, ?)",
    );
    for (const r of rows) ins.run(...r);
  }

  it("carries a note to a key that has none", () => {
    const { db } = newDb();
    seedNotes(db, [["path:a", "from path", 1]]);
    migrateMetaKey(db, "path:a", "h");
    expect(noteRow(db, "h")?.note).toBe("from path");
    expect(noteRow(db, "path:a")).toBeUndefined();
  });

  it("keeps the target's note when the source has none", () => {
    const { db } = newDb();
    seedNotes(db, [
      ["path:a", null, 5],
      ["h", "held", 1],
    ]);
    migrateMetaKey(db, "path:a", "h");
    expect(noteRow(db, "h")?.note).toBe("held");
  });

  it("joins two different notes, the held one first", () => {
    const { db } = newDb();
    seedNotes(db, [
      ["path:a", "incoming", 1],
      ["h", "held", 2],
    ]);
    migrateMetaKey(db, "path:a", "h");
    expect(noteRow(db, "h")?.note).toBe("held\n\n---\n\nincoming");
  });

  it("does not repeat a note that is already one whole part of the other", () => {
    const { db } = newDb();
    seedNotes(db, [
      // The incoming note is one part of a note joined before.
      ["path:a", "b", 1],
      ["h", "a\n\n---\n\nb", 2],
      // The held note is one part of the incoming one.
      ["path:b", "a\n\n---\n\nb", 1],
      ["h2", "a", 2],
      // The same note on both sides.
      ["path:c", "same", 1],
      ["h3", "same", 2],
    ]);
    migrateMetaKey(db, "path:a", "h");
    migrateMetaKey(db, "path:b", "h2");
    migrateMetaKey(db, "path:c", "h3");
    expect(noteRow(db, "h")?.note).toBe("a\n\n---\n\nb");
    expect(noteRow(db, "h2")?.note).toBe("a\n\n---\n\nb");
    expect(noteRow(db, "h3")?.note).toBe("same");
  });

  it("still joins a note that only appears inside the other's text", () => {
    const { db } = newDb();
    seedNotes(db, [
      ["path:a", "OK", 1],
      ["h", "Not OK, re-encode", 2],
    ]);
    migrateMetaKey(db, "path:a", "h");
    expect(noteRow(db, "h")?.note).toBe("Not OK, re-encode\n\n---\n\nOK");
  });

  it("changes nothing when the same row is merged again", () => {
    const { db } = newDb();
    seedNotes(db, [["h", "held", 2]]);
    const merge = db.prepare(
      `INSERT INTO file_meta (meta_key, note, updated_at) VALUES ('h', ?, 1)
       ON CONFLICT (meta_key) DO UPDATE SET ${FILE_META_MERGE_SET}`,
    );
    merge.run("incoming");
    const once = noteRow(db, "h")?.note;
    merge.run("incoming");
    expect(once).toBe("held\n\n---\n\nincoming");
    expect(noteRow(db, "h")?.note).toBe(once);
  });
});

describe("the note column on an existing library", () => {
  it("is added to a library created before notes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-note-"));
    try {
      const libraryPath = path.join(dir, "library.sqlite");
      const old = new Database(libraryPath);
      old.exec(`CREATE TABLE file_meta (
        meta_key TEXT PRIMARY KEY,
        rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        last_accessed_at INTEGER,
        thumb_offset_sec REAL,
        resume_position REAL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO file_meta (meta_key, rating, updated_at) VALUES ('h', 3, 1);`);
      old.close();

      const db = openDb(":memory:", libraryPath);
      expect(
        db.prepare("SELECT meta_key, rating, note FROM lib.file_meta").all(),
      ).toEqual([{ meta_key: "h", rating: 3, note: null }]);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
