// The first launch after the upgrade: Workspaces.bootstrap leaves the
// workspaces the library has no record of unopened, and mergePending opens
// them one at a time, reporting how far it has got, so the window can show it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");
const { Core } = await import("../index.js");
const { openDb, usesOwnMetadata } = await import("../db.js");
const paths = await import("../paths.js");
const { LEGACY_METADATA_DDL } = await import("./helpers.js");
const { backupLibraryNow } = await import("../libraryBackup.js");

let roots: string[] = [];

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-merge-"));
  roots = [];
});
afterEach(() => {
  for (const dir of [userData, ...roots]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A registered workspace whose database the version before the library
 *  left: its own metadata tables, with one favorite. */
function legacyWorkspace(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "meguri-merge-root-")),
  );
  roots.push(root);
  const dataDir = paths.dataDirForRoot(Core.resolveRoot(root));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(paths.dbPathForDataDir(dataDir), paths.libraryDbPath());
  db.exec(LEGACY_METADATA_DDL);
  db.exec(
    "INSERT INTO file_meta (meta_key, favorite, updated_at) VALUES ('h', 1, 1)",
  );
  db.close();
  return root;
}

function register(rootPaths: string[]): void {
  const ws = new Workspaces();
  for (const root of rootPaths) ws.add(root);
  ws.closeAll();
}

const backupOf = (root: string) =>
  paths.backupDbPathForDataDir(paths.dataDirForRoot(Core.resolveRoot(root)));

describe("merging workspaces into the library at startup", () => {
  it("leaves them unopened at bootstrap and merges them one at a time", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);

    const ws = new Workspaces();
    const init = vi.spyOn(Core, "init");
    ws.bootstrap(null);
    expect(init).not.toHaveBeenCalled();
    expect(ws.mergeProgress()).toEqual({ done: 0, total: 2 });
    // Nothing else opens them meanwhile (the status bar's stats, a view).
    expect(ws.allCores()).toEqual([]);
    expect(init).not.toHaveBeenCalled();

    const seen: { done: number; total: number }[] = [];
    const failed = await ws.mergePending((p) => seen.push(p));
    init.mockRestore();

    expect(failed).toEqual([]);
    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    expect(ws.mergeProgress()).toBeNull();
    const core = ws.byId(Workspaces.idFor(a))!;
    expect(usesOwnMetadata(core.db)).toBe(false);
    expect(
      core.db.prepare("SELECT favorite FROM lib.file_meta").pluck().get(),
    ).toBe(1);
    // The library is the one place their metadata lives: their copies stay
    // until a copy of the library holds it.
    expect(fs.existsSync(backupOf(a))).toBe(true);
    ws.dropCoveredBackups(
      backupLibraryNow(paths.libraryDbPath(), paths.libraryBackupDir()),
    );
    expect(fs.existsSync(backupOf(a))).toBe(false);
    expect(fs.existsSync(backupOf(b))).toBe(false);
    ws.closeAll();
  });

  it("keeps a workspace's copy that no copy of the library covers", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    const ws = new Workspaces();
    ws.bootstrap(null);
    // b cannot merge: the library has no record of it.
    fs.mkdirSync(path.join(backupOf(b), "taken"), { recursive: true });
    await ws.mergePending(() => {});

    // A library copy older than a's own copy holds nothing of a.
    ws.dropCoveredBackups(fs.statSync(backupOf(a)).mtimeMs - 1);
    expect(fs.existsSync(backupOf(a))).toBe(true);
    ws.dropCoveredBackups(Date.now() + 1000);
    expect(fs.existsSync(backupOf(a))).toBe(false);
    expect(fs.existsSync(backupOf(b))).toBe(true);
    ws.closeAll();
  });

  it("has nothing to merge for a workspace with no database yet", () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "meguri-merge-root-")),
    );
    roots.push(root);
    const first = new Workspaces();
    first.add(root);
    // Registered, never opened: no database, no library either.
    first.closeAll();
    fs.rmSync(paths.dataDirForRoot(Core.resolveRoot(root)), {
      recursive: true,
      force: true,
    });
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(paths.libraryDbPath() + suffix, { force: true });
    }

    const ws = new Workspaces();
    ws.bootstrap(null);
    expect(ws.mergeProgress()).toBeNull();
    ws.closeAll();
  });

  it("has nothing to do on the next launch", async () => {
    const a = legacyWorkspace();
    register([a]);
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    first.closeAll();

    const ws = new Workspaces();
    ws.bootstrap(null);
    expect(ws.mergeProgress()).toBeNull();
    ws.closeAll();
  });

  it("reports a workspace whose merge could not run, which keeps its own tables", async () => {
    const a = legacyWorkspace();
    register([a]);
    // The copy cannot be written: its path is taken by a directory.
    fs.mkdirSync(path.join(backupOf(a), "taken"), { recursive: true });

    const ws = new Workspaces();
    ws.bootstrap(null);
    const failed = await ws.mergePending(() => {});

    const label = path.basename(a);
    expect(failed).toEqual([{ label, reason: "backup" }]);
    const core = ws.byId(Workspaces.idFor(a))!;
    expect(usesOwnMetadata(core.db)).toBe(true);
    expect(ws.mergeFailures()).toEqual([{ label, reason: "backup" }]);
    ws.closeAll();
  });

  it("merges a failed workspace on retry once the cause is gone", async () => {
    const a = legacyWorkspace();
    register([a]);
    const taken = path.join(backupOf(a), "taken");
    fs.mkdirSync(taken, { recursive: true });
    const ws = new Workspaces();
    ws.bootstrap(null);
    await ws.mergePending(() => {});
    expect(usesOwnMetadata(ws.byId(Workspaces.idFor(a))!.db)).toBe(true);

    // The user frees the way, then picks "Try again": pending again at once,
    // so the window shows the merge while the scans stop.
    fs.rmSync(backupOf(a), { recursive: true, force: true });
    expect(ws.beginRetry()).toEqual([Workspaces.idFor(a)]);
    expect(ws.mergeProgress()).toEqual({ done: 0, total: 1 });
    const seen: { done: number; total: number }[] = [];
    const failed = await ws.retryMerge((p) => seen.push(p));

    expect(failed).toEqual([]);
    expect(seen).toEqual([{ done: 1, total: 1 }]);
    expect(usesOwnMetadata(ws.byId(Workspaces.idFor(a))!.db)).toBe(false);
    expect(ws.mergeFailures()).toEqual([]);
    // Nothing left to retry.
    expect(ws.beginRetry()).toBeNull();
    expect(await ws.retryMerge(() => {})).toBeNull();
    ws.closeAll();
  });

  it("keeps the failures when a retry is given up", async () => {
    const a = legacyWorkspace();
    register([a]);
    fs.mkdirSync(path.join(backupOf(a), "taken"), { recursive: true });
    const ws = new Workspaces();
    ws.bootstrap(null);
    await ws.mergePending(() => {});

    expect(ws.beginRetry()).not.toBeNull();
    ws.cancelRetry();
    expect(ws.mergeProgress()).toBeNull();
    expect(ws.mergeFailures()).toEqual([
      { label: path.basename(a), reason: "backup" },
    ]);
    ws.closeAll();
  });

  it("does not reopen a workspace removed while the merge runs", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    const ws = new Workspaces();
    ws.bootstrap(null);
    const dataDirB = paths.dataDirForRoot(Core.resolveRoot(b));

    await ws.mergePending((p) => {
      if (p.done === 1) ws.remove(b);
    });

    expect(fs.existsSync(dataDirB)).toBe(false);
    const listed = ws.list().map((w) => w.path);
    expect(listed).toContain(a);
    expect(listed).not.toContain(b);
    ws.closeAll();
  });

  it("stops when the app quits, leaving the rest for the next launch", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    const ws = new Workspaces();
    ws.bootstrap(null);

    const failed = await ws.mergePending((p) => {
      if (p.done === 1) ws.closeAll();
    });

    expect(failed).toEqual([]);
    const next = new Workspaces();
    next.bootstrap(null);
    expect(next.mergeProgress()).toEqual({ done: 0, total: 1 });
    next.closeAll();
  });

  it("reaches a workspace recorded but still on its own tables for a write to every workspace", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    first.closeAll();
    // a's merge committed, its drop did not: own tables back, not complete.
    const db = openDb(
      paths.dbPathForDataDir(paths.dataDirForRoot(Core.resolveRoot(a))),
      paths.libraryDbPath(),
    );
    db.exec(LEGACY_METADATA_DDL);
    db.prepare(
      "UPDATE lib.migrated_workspaces SET complete = 0 WHERE workspace_id = ?",
    ).run(Core.dataIdFor(a));
    db.close();

    const ws = new Workspaces();
    ws.bootstrap(null);
    // Not taken as merged: due for the merge again.
    expect(ws.mergeProgress()).toEqual({ done: 0, total: 1 });
    const ids = ws.metadataCores().map((c) => c.id);
    expect(ids).toContain(Workspaces.idFor(a));
    expect(usesOwnMetadata(ws.byId(Workspaces.idFor(a))!.db)).toBe(false);
    ws.closeAll();
  });

  it("reaches the library when every open workspace is still on its own tables", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    // a cannot merge; b can.
    fs.mkdirSync(path.join(backupOf(a), "taken"), { recursive: true });
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    first.closeAll();

    const ws = new Workspaces();
    ws.bootstrap(null);
    await ws.mergePending(() => {});
    // Only a, on its own tables, is open; b is on the library, unopened.
    const cores = ws.metadataCores();
    expect(cores.some(({ core }) => !usesOwnMetadata(core.db))).toBe(true);
    expect(cores.some(({ core }) => usesOwnMetadata(core.db))).toBe(true);
    ws.closeAll();
  });

  it("keeps the data of a workspace removed before its metadata could be merged", async () => {
    const a = legacyWorkspace();
    register([a]);
    fs.mkdirSync(path.join(backupOf(a), "taken"), { recursive: true });
    const ws = new Workspaces();
    ws.bootstrap(null);
    await ws.mergePending(() => {});

    ws.remove(a);

    expect(ws.list().map((w) => w.path)).not.toContain(a);
    const dataDir = paths.dataDirForRoot(Core.resolveRoot(a));
    expect(fs.existsSync(paths.dbPathForDataDir(dataDir))).toBe(true);
    ws.closeAll();
  });

  it("removes a merged workspace without opening it", async () => {
    const a = legacyWorkspace();
    const b = legacyWorkspace();
    register([a, b]);
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    first.closeAll();

    const ws = new Workspaces();
    ws.bootstrap(null);
    const init = vi.spyOn(Core, "init");
    ws.remove(b);
    expect(init).not.toHaveBeenCalled();
    init.mockRestore();
    expect(fs.existsSync(paths.dataDirForRoot(Core.resolveRoot(b)))).toBe(
      false,
    );
    ws.closeAll();
  });

  it("merges a workspace again from its backup when the library lost it", async () => {
    const a = legacyWorkspace();
    register([a]);
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    expect(first.mergedInLastRun()).toBe(1);
    first.closeAll();
    // Put back from a copy older than the merge: no record, no metadata.
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(paths.libraryDbPath() + suffix, { force: true });
    }

    const ws = new Workspaces();
    ws.bootstrap(null);
    expect(ws.mergeProgress()).toEqual({ done: 0, total: 1 });
    expect(await ws.mergePending(() => {})).toEqual([]);
    expect(ws.mergedInLastRun()).toBe(1);
    const core = ws.byId(Workspaces.idFor(a))!;
    expect(
      core.db.prepare("SELECT favorite FROM lib.file_meta").pluck().get(),
    ).toBe(1);
    // Kept until a copy of the library holds it again.
    expect(fs.existsSync(backupOf(a))).toBe(true);
    ws.closeAll();

    const next = new Workspaces();
    next.bootstrap(null);
    expect(next.mergeProgress()).toBeNull();
    next.closeAll();
  });

  it("counts no merge for workspaces already on the library", async () => {
    const a = legacyWorkspace();
    register([a]);
    const first = new Workspaces();
    first.bootstrap(null);
    await first.mergePending(() => {});
    first.closeAll();
    // A record from before `complete`: opened once more, nothing to move.
    const db = openDb(
      paths.dbPathForDataDir(paths.dataDirForRoot(Core.resolveRoot(a))),
      paths.libraryDbPath(),
    );
    db.exec("UPDATE lib.migrated_workspaces SET complete = 0");
    db.close();

    const ws = new Workspaces();
    ws.bootstrap(null);
    await ws.mergePending(() => {});
    expect(ws.mergedInLastRun()).toBe(0);
    ws.closeAll();
  });
});
