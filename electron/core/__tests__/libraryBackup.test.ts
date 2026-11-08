import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_EVERY_MS,
  BACKUPS_KEPT,
  backupLibraryNow,
  maintainLibrary,
  newestBackupTime,
} from "../libraryBackup.js";

let dir: string;
let library: string;
let backups: string;
const DAY = BACKUP_EVERY_MS;
const T0 = Date.UTC(2026, 10, 1, 12);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-libbak-"));
  library = path.join(dir, "library.sqlite");
  backups = path.join(dir, "library-backups");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeLibrary(favorites: number): void {
  const db = new Database(library);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS file_meta (meta_key TEXT, favorite INT)");
  db.exec(
    "CREATE TABLE IF NOT EXISTS tag_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, meta_key TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO tag_changes (meta_key) VALUES ('k')").run();
  db.exec("DELETE FROM file_meta");
  for (let i = 0; i < favorites; i++) {
    db.prepare("INSERT INTO file_meta VALUES (?, 1)").run(`k${i}`);
  }
  db.close();
}

const copies = () => (fs.existsSync(backups) ? fs.readdirSync(backups) : []);

/** Age every copy so the next run sees it as taken at `time`. */
function dateCopies(time: number): void {
  for (const n of copies()) {
    fs.utimesSync(path.join(backups, n), time / 1000, time / 1000);
  }
}

const favorites = () => {
  const db = new Database(library, { readonly: true });
  const n = db.prepare("SELECT count(*) AS n FROM file_meta").pluck().get();
  db.close();
  return n;
};

describe("maintainLibrary", () => {
  it("does nothing before the library exists", () => {
    expect(maintainLibrary(library, backups, T0)).toBeNull();
    expect(copies()).toEqual([]);
  });

  it("copies a sound library at most once a day and keeps the newest few", () => {
    writeLibrary(1);
    maintainLibrary(library, backups, T0);
    expect(copies()).toHaveLength(1);
    dateCopies(T0);

    // Within the day: no new copy.
    maintainLibrary(library, backups, T0 + DAY / 2);
    expect(copies()).toHaveLength(1);

    for (let d = 1; d <= BACKUPS_KEPT + 2; d++) {
      maintainLibrary(library, backups, T0 + d * DAY);
      // Each copy dated when it was taken, the older ones before it.
      const names = copies().sort();
      fs.utimesSync(
        path.join(backups, names[names.length - 1]),
        (T0 + d * DAY) / 1000,
        (T0 + d * DAY) / 1000,
      );
    }
    expect(copies()).toHaveLength(BACKUPS_KEPT);
  });

  it("puts the newest copy back when the library is damaged, setting it aside", () => {
    writeLibrary(3);
    maintainLibrary(library, backups, T0);
    dateCopies(T0);
    // Later changes, then damage.
    writeLibrary(5);
    fs.writeFileSync(library, "not a database ".repeat(500));

    const restored = maintainLibrary(library, backups, T0 + DAY);

    expect(restored).toBe(Math.floor(T0 / 1000));
    expect(favorites()).toBe(3);
    const aside = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("library.damaged-"));
    expect(aside).toEqual([`library.damaged-${T0 + DAY}.sqlite`]);
  });

  it("leaves a damaged library alone when there is no copy to put back", () => {
    fs.writeFileSync(library, "not a database ".repeat(500));
    expect(maintainLibrary(library, backups, T0)).toBeNull();
    expect(fs.readFileSync(library, "utf8")).toMatch(/^not a database/);
    expect(copies()).toEqual([]);
  });

  it("puts a copy back when the library has gone", () => {
    writeLibrary(2);
    maintainLibrary(library, backups, T0);
    dateCopies(T0);
    fs.rmSync(library);

    expect(maintainLibrary(library, backups, T0 + DAY)).toBe(
      Math.floor(T0 / 1000),
    );
    expect(favorites()).toBe(2);
  });

  it("sets aside the WAL a gone library left, before putting a copy back", () => {
    writeLibrary(2);
    maintainLibrary(library, backups, T0);
    dateCopies(T0);
    fs.rmSync(library);
    // Another database's frames, which SQLite would apply to the copy.
    fs.writeFileSync(`${library}-wal`, "frames of another database");

    expect(maintainLibrary(library, backups, T0 + DAY)).not.toBeNull();
    expect(fs.existsSync(`${library}-wal`)).toBe(false);
    expect(
      fs
        .readdirSync(dir)
        .some((n) => /^library\.damaged-\d+\.sqlite-wal$/.test(n)),
    ).toBe(true);
    expect(favorites()).toBe(2);
  });

  it("moves the sequence of the copy put back far ahead, with its log emptied", () => {
    writeLibrary(1);
    maintainLibrary(library, backups, T0);
    dateCopies(T0);
    fs.writeFileSync(library, "not a database ".repeat(500));

    maintainLibrary(library, backups, T0 + DAY);

    const db = new Database(library, { readonly: true });
    expect(db.prepare("SELECT count(*) FROM tag_changes").pluck().get()).toBe(
      0,
    );
    // Ahead of any seq a workspace recorded from the library it replaced, so
    // each rebuilds its keyword index rather than trusting it (catchUpTagIndex).
    expect(
      db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tag_changes'")
        .pluck()
        .get(),
    ).toBeGreaterThan(1_000_000);
    db.close();
  });

  it("does not take a copy dated ahead of now for a fresh one", () => {
    writeLibrary(1);
    maintainLibrary(library, backups, T0);
    // A clock that jumped ahead when that copy was taken.
    dateCopies(T0 + 10 * DAY);
    maintainLibrary(library, backups, T0 + DAY);
    expect(copies()).toHaveLength(2);
  });

  it("takes a copy dated ahead of now for the stalest, not the newest", () => {
    // On the real clock: the copies taken below carry its mtime.
    const base = Date.now();
    writeLibrary(1);
    maintainLibrary(library, backups, base);
    // A clock that jumped ahead when that copy was taken.
    dateCopies(base + 10 * DAY);
    expect(newestBackupTime(backups, base + 1000)).toBeNull();
    const at = (i: number) => base + 1000 + i;
    for (let i = 1; i <= BACKUPS_KEPT; i++) {
      backupLibraryNow(library, backups, at(i));
    }
    // The copies taken since stay; the one dated ahead goes first.
    expect(copies()).toHaveLength(BACKUPS_KEPT);
    const newest = newestBackupTime(backups, at(BACKUPS_KEPT));
    expect(newest).not.toBeNull();
    expect(newest!).toBeLessThanOrEqual(at(BACKUPS_KEPT));
  });

  it("keeps the copy just taken when its mtime is a moment past now", () => {
    writeLibrary(1);
    const base = Date.now();
    for (let i = 0; i < BACKUPS_KEPT; i++) {
      backupLibraryNow(library, backups, base - 60_000 + i);
    }
    dateCopies(base - 60_000);
    // Taken "now" by a clock read before the copy was written.
    const taken = backupLibraryNow(library, backups, base - 1000);
    expect(taken).not.toBeNull();
    expect(copies()).toHaveLength(BACKUPS_KEPT);
    expect(newestBackupTime(backups)).toBe(taken);
  });

  it("copies right away after a merge, however fresh the newest copy is", () => {
    writeLibrary(1);
    maintainLibrary(library, backups, T0);
    expect(backupLibraryNow(library, backups, T0 + 1000)).toEqual(
      expect.any(Number),
    );
    expect(copies()).toHaveLength(2);
  });
});
