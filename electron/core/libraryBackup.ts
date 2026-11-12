// Dated copies of the shared library (`library.sqlite`), and putting one back
// when the library is found damaged. Every workspace reads its metadata from
// that one file, and once a workspace has moved its metadata there nothing
// else holds it, so a damaged library would leave every workspace unable to
// open with nothing to go back to.
//
// Runs at startup before any workspace is opened (app.ts): the library is
// checked (`PRAGMA quick_check`); a sound one gets a copy when the newest is
// older than BACKUP_EVERY_MS, keeping the BACKUPS_KEPT newest; a damaged one is
// set aside next to itself and the newest copy put in its place. With no copy
// to go back to, it is left as it is: the workspaces then fail to open as
// they would have, and nothing is replaced by an empty library.
import fs from "node:fs";
import path from "node:path";
import {
  errorCode,
  openLibraryForRepair,
  openLibraryReadonlyOrThrow,
  type DB,
} from "./db.js";
import { scopedLog } from "./logger.js";

const log = scopedLog("library-backup");

export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
export const BACKUPS_KEPT = 5;
/** How far ahead of the clock a copy may be dated before it counts as taken
 *  by a clock that jumped: a copy just written is a moment ahead of a `now`
 *  read before it, and mtimes carry fractions of a millisecond. */
const CLOCK_SLACK_MS = 60_000;
const isAhead = (time: number, now: number) => time > now + CLOCK_SLACK_MS;
const PREFIX = "library-";
const SUFFIX = ".sqlite";

/** SQLite's codes for a file that is not a sound database, extended ones
 *  (SQLITE_CORRUPT_INDEX, …) included. */
const isDamagedCode = (code: string) =>
  code.startsWith("SQLITE_CORRUPT") || code.startsWith("SQLITE_NOTADB");

type Health = "sound" | "damaged" | "unreadable";

function checkLibrary(file: string): Health {
  let db: DB | undefined;
  try {
    db = openLibraryReadonlyOrThrow(file);
    return db.pragma("quick_check", { simple: true }) === "ok"
      ? "sound"
      : "damaged";
  } catch (e) {
    const code = errorCode(e);
    if (code !== undefined && isDamagedCode(code)) return "damaged";
    // Locked, unreadable, …: nothing says it is damaged, so it is left alone.
    log.warn(`could not check the library ${file}:`, e);
    return "unreadable";
  } finally {
    db?.close();
  }
}

/** The copies in `dir`, newest first; one dated ahead of `now` (a clock that
 *  jumped when it was taken) comes after every other, as the stalest. */
function listBackups(
  dir: string,
  now: number = Date.now(),
): { file: string; time: number }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
    .map((n) => {
      const file = path.join(dir, n);
      return { file, time: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => {
      const aheadA = isAhead(a.time, now);
      const aheadB = isAhead(b.time, now);
      if (aheadA !== aheadB) return aheadA ? 1 : -1;
      return b.time - a.time;
    });
}

/** `library-20261108T123456789.sqlite`, in UTC, to the millisecond. */
function backupName(now: number): string {
  const stamp = new Date(now)
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace(/Z$/, "");
  return `${PREFIX}${stamp}${SUFFIX}`;
}

/** Copy the library into `dir`, dropping the oldest copies beyond
 *  BACKUPS_KEPT. Returns when the copy was taken (its mtime, ms), or null. */
function takeBackup(file: string, dir: string, now: number): number | null {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, backupName(now));
  // VACUUM INTO refuses an existing file, and the failure path below would
  // then delete a good copy of the same name (a clock set back).
  if (fs.existsSync(target)) return null;
  let db: DB | undefined;
  try {
    db = openLibraryReadonlyOrThrow(file);
    db.prepare("VACUUM INTO ?").run(target);
  } catch (e) {
    fs.rmSync(target, { force: true });
    log.warn("could not copy the library:", e);
    return null;
  } finally {
    db?.close();
  }
  // The copy just taken is kept whatever its mtime says: written after `now`,
  // it can be dated a moment ahead of it, which listBackups orders last.
  const others = listBackups(dir, now).filter((b) => b.file !== target);
  for (const old of others.slice(BACKUPS_KEPT - 1)) {
    fs.rmSync(old.file, { force: true });
  }
  return fs.statSync(target).mtimeMs;
}

/** When the newest copy in `dir` was taken (ms), or null with none: one
 *  dated ahead of now does not count. */
export function newestBackupTime(
  dir: string,
  now: number = Date.now(),
): number | null {
  const newest = listBackups(dir, now)[0];
  return newest && !isAhead(newest.time, now) ? newest.time : null;
}

/**
 * Move the library, with its WAL and shared-memory files, aside: whatever of
 * them is there, so a copy put in its place never meets the WAL of another
 * database. The WAL and shared-memory files go first: a failure partway
 * leaves the library where it was.
 */
function setAside(file: string, now: number): string {
  const aside = file.replace(/\.sqlite$/, `.damaged-${now}.sqlite`);
  for (const suffix of ["-wal", "-shm", ""]) {
    if (fs.existsSync(file + suffix)) {
      fs.renameSync(file + suffix, aside + suffix);
    }
  }
  return aside;
}

/**
 * Prepare a copy about to replace the library: its change log is emptied and
 * its sequence moved far ahead, so every workspace, whatever it last applied
 * from the library being replaced, finds itself behind the log and rebuilds
 * its keyword index (catchUpTagIndex) rather than trusting a sequence that
 * went back.
 */
function forgetTagChanges(file: string): void {
  const db = openLibraryForRepair(file);
  try {
    db.transaction(() => {
      db.exec("DELETE FROM tag_changes");
      const row = db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tag_changes'")
        .get() as { seq: number } | undefined;
      const ahead = (row?.seq ?? 0) + SEQUENCE_JUMP;
      db.prepare(
        "DELETE FROM sqlite_sequence WHERE name = 'tag_changes'",
      ).run();
      db.prepare(
        "INSERT INTO sqlite_sequence (name, seq) VALUES ('tag_changes', ?)",
      ).run(ahead);
    })();
  } finally {
    db.close();
  }
}

/** Far more tag changes than one library could have logged since a copy. */
const SEQUENCE_JUMP = 1_000_000_000;

/**
 * Put the newest sound copy in place of the library, what is left of which
 * is set aside first (setAside). Copied, repaired and checked beside it before
 * anything is moved, so a copy that fails (a full disk) never leaves no
 * library, which the next open would create empty. Returns when the copy put
 * back was taken (Unix seconds), or null.
 */
function restoreNewest(
  file: string,
  backups: { file: string; time: number }[],
  now: number,
  damaged: boolean,
): number | null {
  const restore = backups.find((b) => checkLibrary(b.file) === "sound");
  if (!restore) {
    log.error(
      `the library ${file} is ${damaged ? "damaged" : "missing"} and there is no copy to put back`,
    );
    return null;
  }
  const incoming = `${file}.restoring`;
  try {
    fs.copyFileSync(restore.file, incoming);
    forgetTagChanges(incoming);
    if (checkLibrary(incoming) !== "sound") {
      throw new Error(`the copy of ${restore.file} is not sound`);
    }
  } catch (e) {
    fs.rmSync(incoming, { force: true });
    log.error("could not put a copy of the library back:", e);
    return null;
  }
  try {
    const aside = setAside(file, now);
    fs.renameSync(incoming, file);
    log.warn(
      `the library was ${damaged ? "damaged" : "missing"}: set what was left aside as ${aside} and put back ${restore.file}`,
    );
  } catch (e) {
    fs.rmSync(incoming, { force: true });
    log.error("could not put a copy of the library back:", e);
    return null;
  }
  return Math.floor(restore.time / 1000);
}

/**
 * Whether the library is gone while copies of it exist: what is left after
 * maintainLibrary could not put one back. Opening a workspace then would
 * start an empty library in its place.
 */
export function isLibraryLost(
  file: string,
  dir: string,
  now: number = Date.now(),
): boolean {
  return !fs.existsSync(file) && listBackups(dir, now).length > 0;
}

/**
 * Check the library and keep its copies current; put the newest copy back
 * when it is damaged, or gone while copies of it exist (a library is only
 * ever copied once it holds something, so no copy means a first launch).
 * Returns when the copy put back was taken (Unix seconds), or null when
 * nothing was put back. Never throws.
 */
export function maintainLibrary(
  file: string,
  dir: string,
  now: number = Date.now(),
): number | null {
  try {
    const backups = listBackups(dir, now);
    if (!fs.existsSync(file)) {
      return backups.length > 0
        ? restoreNewest(file, backups, now, false)
        : null;
    }
    const health = checkLibrary(file);
    if (health === "unreadable") return null;
    if (health === "damaged") return restoreNewest(file, backups, now, true);
    const newest = backups[0];
    // A copy dated ahead of now (a clock that jumped) does not count as fresh.
    if (
      !newest ||
      isAhead(newest.time, now) ||
      now - newest.time >= BACKUP_EVERY_MS
    ) {
      takeBackup(file, dir, now);
    }
    return null;
  } catch (e) {
    log.error("could not check or back up the library:", e);
    return null;
  }
}

/**
 * Copy the library now, whatever the age of the newest copy: right after
 * workspaces merged into it, when it holds metadata nothing else does any
 * more. Returns when the copy was taken (ms), or null. Never throws.
 */
export function backupLibraryNow(
  file: string,
  dir: string,
  now: number = Date.now(),
): number | null {
  try {
    return fs.existsSync(file) ? takeBackup(file, dir, now) : null;
  } catch (e) {
    log.error("could not back up the library:", e);
    return null;
  }
}
