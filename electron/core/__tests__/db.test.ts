// Regression tests for db.ts: schema bootstrap + idempotent column backfills for
// DBs that pre-date a column added after release.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db.js";

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

describe("migrateKindCheck", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-kind-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function filesDdl(db: Database.Database): string {
    return (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='files'",
        )
        .get() as { sql: string }
    ).sql;
  }

  function indexNames(db: Database.Database): string[] {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='files' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
  }

  /** Build a DB with the current schema, then swap `files` back to the pre-audio
   *  shape (two-kind CHECK, no btime) and seed it, emulating a legacy on-disk DB. */
  function makeLegacyDb(file: string): void {
    const db = openDb(file);
    db.exec(`
      DROP TABLE files;
      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL, abs_path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('video','image')),
        ext TEXT, size INTEGER, inode INTEGER, content_hash TEXT,
        width INTEGER, height INTEGER, duration REAL, codec TEXT, fps REAL, captured_at INTEGER,
        thumb_path TEXT, thumb_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (thumb_status IN ('pending','done','error')),
        deleted_at INTEGER, excluded_at INTEGER, created_at INTEGER NOT NULL, meta TEXT,
        meta_key TEXT GENERATED ALWAYS AS
          (COALESCE(content_hash, 'p:' || root_id || ':' || rel_path)) VIRTUAL,
        UNIQUE (root_id, rel_path)
      );
      INSERT INTO scan_roots (id, path, path_hash, created_at) VALUES (1, '/r', 'h', 0);
      -- id 7 is deliberately not 1: the rebuild must carry ids across verbatim
      -- because files_fts is external-content keyed on rowid.
      INSERT INTO files (id, root_id, rel_path, abs_path, kind, content_hash, created_at)
        VALUES (7, 1, 'a.mp4', '/r/a.mp4', 'video', 'hash-a', 0),
               (9, 1, 'b.jpg', '/r/b.jpg', 'image', NULL, 0);
      -- meta_key-keyed user data: the Principle IV guarantee under a table rebuild.
      INSERT INTO file_meta (meta_key, rating, favorite, updated_at)
        VALUES ('hash-a', 4, 1, 0);
      INSERT INTO tags (id, name) VALUES (10, 'sunset');
      INSERT INTO meta_tags (meta_key, tag_id, source) VALUES ('hash-a', 10, 'manual');
      INSERT INTO play_history (meta_key, played_at, via) VALUES ('hash-a', 123, 'browser');
    `);
    db.close();
  }

  it("widens the CHECK so a legacy DB accepts an audio row", () => {
    const file = path.join(dir, "legacy.sqlite");
    makeLegacyDb(file);
    const legacy = new Database(file);
    expect(filesDdl(legacy)).not.toContain("audio");
    legacy.close();

    const db = openDb(file);
    expect(filesDdl(db)).toContain("'audio'");
    expect(() =>
      db.exec(
        "INSERT INTO files (id, root_id, rel_path, abs_path, kind, created_at) VALUES (11, 1, 'c.mp3', '/r/c.mp3', 'audio', 0)",
      ),
    ).not.toThrow();
    db.close();
  });

  it("preserves ids, row count, and meta_key values across the rebuild", () => {
    const file = path.join(dir, "preserve.sqlite");
    makeLegacyDb(file);
    const db = openDb(file);
    const rows = db
      .prepare("SELECT id, rel_path, kind, meta_key FROM files ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: 7, rel_path: "a.mp4", kind: "video", meta_key: "hash-a" },
      { id: 9, rel_path: "b.jpg", kind: "image", meta_key: "p:1:b.jpg" },
    ]);
    db.close();
  });

  it("restores the indexes that DROP TABLE removed, including the backfilled btime ones", () => {
    const file = path.join(dir, "indexes.sqlite");
    makeLegacyDb(file);
    const db = openDb(file);
    const names = indexNames(db);
    // The legacy table had no btime column at all; backfillColumns must re-add it
    // and its indexes after the rebuild.
    expect(tableColumns(db, "files")).toContain("btime");
    for (const idx of [
      "idx_files_root",
      "idx_files_kind",
      "idx_files_captured",
      "idx_files_content_hash",
      "idx_files_thumb_status",
      "idx_files_excluded",
      "idx_files_meta_key",
      "idx_files_alive",
      "idx_files_alive_rel_path",
      "idx_files_alive_captured",
      "idx_files_btime",
      "idx_files_alive_btime",
    ]) {
      expect(names).toContain(idx);
    }
    db.close();
  });

  it("keeps meta_key-keyed user data attached across the rebuild", () => {
    const file = path.join(dir, "userdata.sqlite");
    makeLegacyDb(file);
    const db = openDb(file);
    const meta = db
      .prepare(
        "SELECT m.rating, m.favorite FROM files f JOIN file_meta m ON m.meta_key = f.meta_key WHERE f.id = 7",
      )
      .get();
    expect(meta).toEqual({ rating: 4, favorite: 1 });
    const tag = db
      .prepare(
        "SELECT t.name FROM files f JOIN meta_tags mt ON mt.meta_key = f.meta_key JOIN tags t ON t.id = mt.tag_id WHERE f.id = 7",
      )
      .get();
    expect(tag).toEqual({ name: "sunset" });
    const play = db
      .prepare(
        "SELECT h.played_at FROM files f JOIN play_history h ON h.meta_key = f.meta_key WHERE f.id = 7",
      )
      .get();
    expect(play).toEqual({ played_at: 123 });
    db.close();
  });

  it("is idempotent: a second open neither throws nor rebuilds again", () => {
    const file = path.join(dir, "again.sqlite");
    makeLegacyDb(file);
    const a = openDb(file);
    a.exec(
      "INSERT INTO files (id, root_id, rel_path, abs_path, kind, created_at) VALUES (11, 1, 'c.mp3', '/r/c.mp3', 'audio', 0)",
    );
    a.close();

    let b!: Database.Database;
    expect(() => {
      b = openDb(file);
    }).not.toThrow();
    // The audio row inserted before the second open survives it: proof the rebuild
    // did not run a second time (a re-run would be harmless here, but a *repeated*
    // rebuild on every open would be a latent performance and risk problem).
    const n = b.prepare("SELECT count(*) AS n FROM files").get() as {
      n: number;
    };
    expect(n.n).toBe(3);
    b.close();
  });

  it("leaves a fresh DB alone (already has the widened CHECK)", () => {
    const db = openDb(":memory:");
    expect(filesDdl(db)).toContain("'audio'");
    db.close();
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
});
