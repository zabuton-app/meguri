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
