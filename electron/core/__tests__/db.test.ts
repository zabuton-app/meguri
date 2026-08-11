// Regression tests for db.ts: schema bootstrap + idempotent column backfills for
// DBs that pre-date a column added after release.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, resyncFtsForKeys } from "../db.js";

function tableColumns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((r) => r.name);
}

describe("openDb / backfillColumns", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-db-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates thumb_offset_sec on a fresh DB", () => {
    const db = openDb(":memory:");
    expect(tableColumns(db, "file_meta")).toContain("thumb_offset_sec");
    db.close();
  });

  it("adds thumb_offset_sec to a pre-existing DB that lacked the column", () => {
    const file = path.join(dir, "legacy.sqlite");
    // Hand-build a DB whose file_meta is the pre-column shape, then close.
    {
      const legacy = new Database(file);
      legacy.exec(`
        CREATE TABLE file_meta (
          meta_key TEXT PRIMARY KEY,
          rating INTEGER NOT NULL DEFAULT 0,
          favorite INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
      `);
      expect(tableColumns(legacy, "file_meta")).not.toContain(
        "thumb_offset_sec",
      );
      legacy.close();
    }
    // Re-open through openDb; backfillColumns should ALTER the missing column in.
    const db = openDb(file);
    expect(tableColumns(db, "file_meta")).toContain("thumb_offset_sec");
    db.close();
  });

  it("is idempotent: opening the same DB twice does not throw on the second ALTER attempt", () => {
    const file = path.join(dir, "twice.sqlite");
    const a = openDb(file);
    a.close();
    // Second open must notice the column already exists and skip the ALTER.
    expect(() => {
      const b = openDb(file);
      b.close();
    }).not.toThrow();
  });
});

describe("migrateFtsToTrigram", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-fts-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function ftsDdl(db: Database.Database): string {
    return (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='files_fts'",
        )
        .get() as { sql: string }
    ).sql;
  }

  /** Build a DB with the current schema, then swap files_fts back to the
   *  pre-trigram (unicode61) shape and seed it, emulating a legacy on-disk DB. */
  function makeLegacyDb(file: string): void {
    const db = openDb(file);
    db.exec(
      "INSERT INTO scan_roots (id, path, path_hash, created_at) VALUES (1, '/r', 'h', 0)",
    );
    db.exec(`
      INSERT INTO files (id, root_id, rel_path, abs_path, kind, created_at)
        VALUES (1, 1, 'alive.mp4', '/r/alive.mp4', 'video', 0),
               (2, 1, 'gone.mp4', '/r/gone.mp4', 'video', 0);
      UPDATE files SET deleted_at = 100 WHERE id = 2;
      INSERT INTO tags (id, name) VALUES (10, 'sunset');
      -- Same tag attached via two sources: the rebuild must emit the name once.
      INSERT INTO meta_tags (meta_key, tag_id, source)
        VALUES ('p:1:alive.mp4', 10, 'manual'), ('p:1:alive.mp4', 10, 'plugin');
      DROP TABLE files_fts;
      CREATE VIRTUAL TABLE files_fts USING fts5(rel_path, tags_text);
      INSERT INTO files_fts (rowid, rel_path, tags_text)
        VALUES (1, 'alive.mp4', 'sunset sunset'), (2, 'gone.mp4', '');
    `);
    db.close();
  }

  it("rebuilds a legacy unicode61 files_fts as trigram and repopulates it", () => {
    const file = path.join(dir, "legacy.sqlite");
    makeLegacyDb(file);
    const db = openDb(file);
    expect(ftsDdl(db)).toContain("trigram");
    const rows = db
      .prepare(
        "SELECT rowid, rel_path, tags_text FROM files_fts ORDER BY rowid",
      )
      .all() as { rowid: number; rel_path: string; tags_text: string }[];
    // Live row kept with its rel_path; duplicate multi-source tag collapsed to one
    // name; the soft-deleted row is not re-added (deleteFromIndex invariant).
    expect(rows).toEqual([
      { rowid: 1, rel_path: "alive.mp4", tags_text: "sunset" },
    ]);
    db.close();
  });

  it("is idempotent: a second open leaves the rebuilt table untouched", () => {
    const file = path.join(dir, "again.sqlite");
    makeLegacyDb(file);
    const a = openDb(file);
    const before = a.prepare("SELECT count(*) AS n FROM files_fts").get() as {
      n: number;
    };
    a.close();
    const b = openDb(file);
    expect(ftsDdl(b)).toContain("trigram");
    const after = b.prepare("SELECT count(*) AS n FROM files_fts").get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
    b.close();
  });

  it("creates a fresh DB with the trigram tokenizer directly", () => {
    const db = openDb(":memory:");
    expect(ftsDdl(db)).toContain("trigram");
    db.close();
  });

  it("leaves generated tags out of the rebuilt index", () => {
    const file = path.join(dir, "qualified.sqlite");
    makeLegacyDb(file);
    const seed = new Database(file);
    seed.exec(`
      INSERT INTO tags (id, name, namespace) VALUES (11, '4k', 'res');
      INSERT INTO meta_tags (meta_key, tag_id, source)
        VALUES ('p:1:alive.mp4', 11, 'auto-meta');
    `);
    seed.close();
    const db = openDb(file);
    const row = db
      .prepare("SELECT tags_text FROM files_fts WHERE rowid = 1")
      .get() as { tags_text: string };
    // Only the user's own tag; the namespaced one is reachable via `meta:`.
    expect(row.tags_text).toBe("sunset");
    db.close();
  });
});

describe("resyncFtsForKeys", () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(":memory:");
    db.exec(`
      INSERT INTO scan_roots (id, path, path_hash, created_at) VALUES (1, '/r', 'h', 0);
      INSERT INTO files (id, root_id, rel_path, abs_path, kind, created_at)
        VALUES (1, 1, 'a.mp4', '/r/a.mp4', 'video', 0),
               (2, 1, 'b.mp4', '/r/b.mp4', 'video', 0);
      INSERT INTO tags (id, name, namespace) VALUES (10, 'beach', ''), (11, '4k', 'res');
      INSERT INTO meta_tags (meta_key, tag_id, source)
        VALUES ('p:1:a.mp4', 10, 'manual'), ('p:1:b.mp4', 11, 'auto-meta');
      INSERT INTO files_fts (rowid, rel_path, tags_text)
        VALUES (1, 'a.mp4', 'stale'), (2, 'b.mp4', 'stale');
    `);
  });
  afterEach(() => db.close());

  function textOf(rowid: number): string {
    return (
      db
        .prepare("SELECT tags_text FROM files_fts WHERE rowid = ?")
        .get(rowid) as { tags_text: string }
    ).tags_text;
  }

  it("re-indexes only the files behind the given meta_keys", () => {
    resyncFtsForKeys(db, ["p:1:a.mp4"]);
    expect(textOf(1)).toBe("beach");
    expect(textOf(2)).toBe("stale");
  });

  it("is a no-op for an empty key list, and clears generated-only rows", () => {
    resyncFtsForKeys(db, []);
    expect(textOf(2)).toBe("stale");
    resyncFtsForKeys(db, ["p:1:a.mp4", "p:1:b.mp4"]);
    // b.mp4 carries only a namespaced tag, which is not indexed.
    expect(textOf(2)).toBe("");
  });

  it("does not re-add a soft-deleted file", () => {
    db.exec("UPDATE files SET deleted_at = 100 WHERE id = 1");
    resyncFtsForKeys(db, ["p:1:a.mp4"]);
    const n = (
      db
        .prepare("SELECT count(*) AS n FROM files_fts WHERE rowid = 1")
        .get() as { n: number }
    ).n;
    expect(n).toBe(0);
  });
});
