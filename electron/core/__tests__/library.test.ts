import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasMainTable, openDb, type DB } from "../db.js";
import { migrateWorkspaceMetadata } from "../library.js";
import { setFavorite } from "../queries.js";
import { LEGACY_METADATA_DDL } from "./helpers.js";

let dir: string;
let libraryPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-library-"));
  libraryPath = path.join(dir, "library.sqlite");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const dbFile = (ws: string) => path.join(dir, ws, "db.sqlite");
const backupFile = (ws: string) =>
  path.join(dir, ws, "db.pre-shared-metadata.sqlite");

/** A workspace DB as the app left it before the library: its own metadata
 *  tables, seeded by `seed`, and one file per given content hash. */
function makeLegacyWorkspace(ws: string, hashes: string[], seed: string): void {
  fs.mkdirSync(path.join(dir, ws), { recursive: true });
  const db = openDb(dbFile(ws), libraryPath);
  db.exec(LEGACY_METADATA_DDL);
  db.exec(
    `INSERT INTO scan_roots (id, path, path_hash, created_at) VALUES (1, '/${ws}', '${ws}', 0)`,
  );
  const ins = db.prepare(
    "INSERT INTO files (root_id, rel_path, abs_path, kind, content_hash, created_at) VALUES (1, ?, ?, 'video', ?, 0)",
  );
  for (const h of hashes) ins.run(`${h}.mp4`, `/${ws}/${h}.mp4`, h);
  db.exec(seed);
  db.close();
}

/** Open a workspace the way Core.init does, merge it, and leave it open. */
function openAndMigrate(ws: string): DB {
  const db = openDb(dbFile(ws), libraryPath);
  migrateWorkspaceMetadata(db, ws, backupFile(ws));
  return db;
}

function libRows(db: DB, sql: string): unknown[] {
  return db.prepare(sql).all();
}

const SEED_A = `
  INSERT INTO file_meta (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
    VALUES ('h1', 3, 1, 100, 5.0, 40.0, 10);
  INSERT INTO tags (id, name, namespace) VALUES (1, '猫', ''), (2, 'Cat', ''), (3, 'long', 'dur');
  INSERT INTO meta_tags (meta_key, tag_id, source) VALUES
    ('h1', 1, 'manual'), ('h2', 2, 'manual'), ('h1', 3, 'auto-meta');
  INSERT INTO scene_bookmarks (meta_key, sec, created_at) VALUES ('h1', 10.0, 1), ('h1', 60.0, 2);
  INSERT INTO play_history (meta_key, played_at, position, via) VALUES
    ('h1', 1000, 12.5, 'browser'), ('h1', 1000, 12.5, 'browser'), ('h1', 2000, NULL, 'external');
`;
const SEED_B = `
  INSERT INTO file_meta (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
    VALUES ('h1', 5, 0, 50, 9.0, NULL, 20);
  INSERT INTO tags (id, name, namespace) VALUES (7, 'cat', ''), (8, '猫', ''), (9, '動物', '');
  INSERT INTO meta_tags (meta_key, tag_id, source) VALUES
    ('h1', 8, 'manual'), ('h1', 9, 'manual'), ('h3', 7, 'manual');
  INSERT INTO scene_bookmarks (meta_key, sec, created_at) VALUES ('h1', 11.5, 3), ('h1', 90.0, 4);
  INSERT INTO play_history (meta_key, played_at, position, via) VALUES
    ('h1', 1000, 12.5, 'browser'), ('h1', 3000, 1.0, 'browser');
`;

describe("migrateWorkspaceMetadata", () => {
  it("merges two workspaces' metadata for the same content by the merge rules", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    makeLegacyWorkspace("b", ["h1", "h3"], SEED_B);
    openAndMigrate("a").close();
    const db = openAndMigrate("b");

    // Favorite OR, rating and last access the higher; the thumbnail frame from
    // the row updated last (B, updated_at 20), and the resume point from A
    // because B has none.
    expect(
      libRows(
        db,
        "SELECT meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at FROM lib.file_meta",
      ),
    ).toEqual([
      {
        meta_key: "h1",
        rating: 5,
        favorite: 1,
        last_accessed_at: 100,
        thumb_offset_sec: 9,
        resume_position: 40,
        updated_at: 20,
      },
    ]);

    // Exact names merge; "Cat" and "cat" stay two rows.
    expect(
      libRows(
        db,
        "SELECT namespace, name FROM lib.tags ORDER BY namespace, name",
      ),
    ).toEqual([
      { namespace: "", name: "Cat" },
      { namespace: "", name: "cat" },
      { namespace: "", name: "動物" },
      { namespace: "", name: "猫" },
      { namespace: "dur", name: "long" },
    ]);
    expect(
      libRows(
        db,
        "SELECT mt.meta_key, t.name, mt.source FROM lib.meta_tags mt JOIN lib.tags t ON t.id = mt.tag_id ORDER BY mt.meta_key, t.name",
      ),
    ).toEqual([
      { meta_key: "h1", name: "long", source: "auto-meta" },
      { meta_key: "h1", name: "動物", source: "manual" },
      { meta_key: "h1", name: "猫", source: "manual" },
      { meta_key: "h2", name: "Cat", source: "manual" },
      { meta_key: "h3", name: "cat", source: "manual" },
    ]);

    // 10.0 and 11.5 are within BOOKMARK_NEAR_EPS: one kept.
    expect(
      libRows(db, "SELECT sec FROM lib.scene_bookmarks ORDER BY sec"),
    ).toEqual([{ sec: 10 }, { sec: 60 }, { sec: 90 }]);

    // Identical events (same time, position and player) kept once.
    expect(
      libRows(
        db,
        "SELECT played_at, position, via FROM lib.play_history ORDER BY played_at",
      ),
    ).toEqual([
      { played_at: 1000, position: 12.5, via: "browser" },
      { played_at: 2000, position: null, via: "external" },
      { played_at: 3000, position: 1, via: "browser" },
    ]);
    db.close();
  });

  it("drops the workspace's own tables, keeps them in the backup, and reads the library after", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    const db = openAndMigrate("a");
    for (const t of [
      "file_meta",
      "tags",
      "meta_tags",
      "scene_bookmarks",
      "play_history",
    ]) {
      expect(hasMainTable(db, t)).toBe(false);
    }
    // Unqualified names now reach the library.
    expect(
      db.prepare("SELECT rating FROM file_meta WHERE meta_key = 'h1'").get(),
    ).toEqual({ rating: 3 });
    // The keyword index carries the library's user tags (not the generated one).
    expect(
      libRows(db, "SELECT rowid, tags_text FROM files_fts ORDER BY rowid"),
    ).toEqual([
      { rowid: 1, tags_text: "猫" },
      { rowid: 2, tags_text: "Cat" },
    ]);
    db.close();

    const backup = new Database(backupFile("a"), { readonly: true });
    const count = (t: string) =>
      (backup.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number })
        .n;
    expect(count("file_meta")).toBe(1);
    expect(count("meta_tags")).toBe(3);
    expect(count("scene_bookmarks")).toBe(2);
    expect(count("play_history")).toBe(3);
    backup.close();
  });

  it("is a no-op on a second open, and on a workspace created after the library", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    openAndMigrate("a").close();
    const before = fs.readFileSync(backupFile("a"));
    const db = openAndMigrate("a");
    expect(
      (
        db.prepare("SELECT count(*) AS n FROM lib.play_history").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
    db.close();
    expect(fs.readFileSync(backupFile("a")).equals(before)).toBe(true);

    fs.mkdirSync(path.join(dir, "fresh"));
    const fresh = openAndMigrate("fresh");
    expect(fs.existsSync(backupFile("fresh"))).toBe(false);
    expect(
      fresh
        .prepare("SELECT 1 FROM lib.migrated_workspaces WHERE workspace_id = ?")
        .get("fresh"),
    ).toBeUndefined();
    fresh.close();
  });

  it("finishes a merge that was recorded but whose tables were not dropped, without duplicating", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    openAndMigrate("a").close();
    // The state a crash between the two transactions leaves: recorded in the
    // library, own tables still there with the same rows. They are merged
    // again, so this also checks that merging the same rows twice adds nothing.
    const db = openDb(dbFile("a"), libraryPath);
    db.exec(LEGACY_METADATA_DDL);
    db.exec(SEED_A);
    migrateWorkspaceMetadata(db, "a", backupFile("a"));

    expect(hasMainTable(db, "file_meta")).toBe(false);
    const n = (t: string) =>
      (
        db.prepare(`SELECT count(*) AS n FROM lib.${t}`).get() as {
          n: number;
        }
      ).n;
    expect(n("meta_tags")).toBe(3);
    expect(n("scene_bookmarks")).toBe(2);
    expect(n("play_history")).toBe(2);
    db.close();
  });

  it("keeps what an older version wrote to tables it recreated after the merge", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    openAndMigrate("a").close();
    // An older version opens the DB, recreates empty own tables, and the user
    // rates and tags a file there.
    const old = openDb(dbFile("a"), libraryPath);
    old.exec(LEGACY_METADATA_DDL);
    old.exec(`
      INSERT INTO file_meta (meta_key, rating, favorite, updated_at) VALUES ('h2', 4, 0, 99);
      INSERT INTO tags (id, name, namespace) VALUES (1, 'later', '');
      INSERT INTO meta_tags (meta_key, tag_id, source) VALUES ('h2', 1, 'manual');
    `);
    old.close();

    const db = openAndMigrate("a");
    expect(hasMainTable(db, "file_meta")).toBe(false);
    expect(
      db
        .prepare("SELECT rating FROM lib.file_meta WHERE meta_key = 'h2'")
        .get(),
    ).toEqual({ rating: 4 });
    expect(
      db
        .prepare(
          "SELECT t.name FROM lib.meta_tags mt JOIN lib.tags t ON t.id = mt.tag_id WHERE mt.meta_key = 'h2' ORDER BY t.name",
        )
        .all(),
    ).toEqual([{ name: "Cat" }, { name: "later" }]);
    db.close();
  });

  it("rolls the merge back and keeps the own tables when it fails partway", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    const db = openDb(dbFile("a"), libraryPath);
    // Make the merge's play_history step fail after file_meta and tags went in.
    db.exec("DROP TABLE lib.play_history");
    expect(() =>
      migrateWorkspaceMetadata(db, "a", backupFile("a")),
    ).not.toThrow();

    expect(hasMainTable(db, "file_meta")).toBe(true);
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT count(*) AS n FROM lib.file_meta")).toBe(0);
    expect(n("SELECT count(*) AS n FROM lib.tags")).toBe(0);
    expect(n("SELECT count(*) AS n FROM lib.migrated_workspaces")).toBe(0);
    db.close();
  });

  it("keeps the workspace's own metadata, readable and writable, when the backup cannot be written", () => {
    makeLegacyWorkspace("a", ["h1", "h2"], SEED_A);
    // A directory where the backup file should go: removing it and VACUUM INTO both fail.
    fs.mkdirSync(path.join(backupFile("a"), "blocker"), { recursive: true });
    const db = openAndMigrate("a");

    expect(hasMainTable(db, "file_meta")).toBe(true);
    expect(
      db
        .prepare(
          "SELECT 1 FROM lib.migrated_workspaces WHERE workspace_id = 'a'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      (
        db.prepare("SELECT count(*) AS n FROM lib.file_meta").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    setFavorite(db, 2, true);
    expect(
      db
        .prepare("SELECT favorite FROM main.file_meta WHERE meta_key = 'h2'")
        .get(),
    ).toEqual({ favorite: 1 });
    db.close();
  });
});
