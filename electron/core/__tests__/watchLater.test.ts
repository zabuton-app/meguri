// Tests for the built-in "Watch Later" collection: seeding, lock guards, and the
// auto-removal helper used when a file is opened.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// workspaces.ts reads/writes <userData>/config.json via appConfig.ts; point that
// at a throwaway directory so each test gets a pristine config.
let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");
const { WATCH_LATER_ID } = await import("../../../shared/workspaceIds.js");
const { loadConfig, saveConfig } = await import("../appConfig.js");

function configFile(): string {
  return path.join(userData, "config.json");
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-watchlater-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("Watch Later seeding", () => {
  it("creates the collection on a fresh config", () => {
    const ws = new Workspaces();
    const watchLater = ws.collections().find((c) => c.id === WATCH_LATER_ID);
    expect(watchLater).toBeDefined();
    expect(watchLater?.locked).toBe(true);
    expect(watchLater?.items).toEqual([]);
  });

  it("persists the seeded collection to disk", () => {
    new Workspaces();
    const onDisk = loadConfig().collections;
    expect(onDisk.filter((c) => c.id === WATCH_LATER_ID)).toHaveLength(1);
  });

  it("is idempotent across repeated loads", () => {
    new Workspaces();
    new Workspaces();
    const ws = new Workspaces();
    expect(
      ws.collections().filter((c) => c.id === WATCH_LATER_ID),
    ).toHaveLength(1);
  });

  it("self-heals a config that was hand-edited to drop it", () => {
    const first = new Workspaces();
    first.addToCollection(WATCH_LATER_ID, "wsA", 1);

    // Simulate a hand-edited / older-build config with no Watch Later entry.
    const config = loadConfig();
    config.collections = config.collections.filter(
      (c) => c.id !== WATCH_LATER_ID,
    );
    saveConfig(config);
    expect(loadConfig().collections).toHaveLength(0);

    const ws = new Workspaces();
    const watchLater = ws.collections().find((c) => c.id === WATCH_LATER_ID);
    expect(watchLater).toBeDefined();
    // Re-seeded fresh: the previous contents are gone, which is expected since
    // the entry itself was removed outside the app.
    expect(watchLater?.items).toEqual([]);
  });

  it("keeps existing user collections and their contents untouched", () => {
    const first = new Workspaces();
    const mine = first.addCollection("Mine");
    first.addToCollection(mine.id, "wsA", 7);

    const ws = new Workspaces();
    const reloaded = ws.collections().find((c) => c.id === mine.id);
    expect(reloaded?.name).toBe("Mine");
    expect(reloaded?.items).toEqual([
      expect.objectContaining({ workspaceId: "wsA", fileId: 7 }),
    ]);
    expect(reloaded?.locked).toBe(false);
  });

  it("does not rewrite config.json when the collection already exists", () => {
    new Workspaces();
    const before = fs.readFileSync(configFile(), "utf8");
    new Workspaces();
    expect(fs.readFileSync(configFile(), "utf8")).toBe(before);
  });
});

describe("config writes preserve fields this class does not own", () => {
  // The update checker writes `update` through updateConfig() while Workspaces
  // holds a startup snapshot. Since opening a file now writes the config (Watch
  // Later auto-removal), a stale wholesale write-back would revert the user's
  // update preferences on something as routine as viewing a video.
  it("keeps update preferences written elsewhere after an auto-removal", () => {
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);

    const config = loadConfig();
    config.update = {
      autoCheck: false,
      ignoredVersion: "9.9.9",
      lastCheckAt: 1234,
    };
    saveConfig(config);

    ws.removeFromWatchLater("wsA", 1);

    expect(loadConfig().update).toEqual({
      autoCheck: false,
      ignoredVersion: "9.9.9",
      lastCheckAt: 1234,
    });
  });

  it("keeps them across collection edits too", () => {
    const ws = new Workspaces();

    const config = loadConfig();
    config.update = { ...config.update, autoCheck: false };
    saveConfig(config);

    ws.addCollection("Mine");

    expect(loadConfig().update.autoCheck).toBe(false);
  });
});

describe("workspace removal cascade", () => {
  // Regression cover for FR-010. `Workspaces.remove()` already strips refs from
  // every collection, so Watch Later inherits it by being an ordinary entry in
  // `config.collections` — no Watch-Later-specific code involved.
  it("drops refs to a removed workspace from Watch Later", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    try {
      const ws = new Workspaces();
      const rootPath = ws.add(root);
      const wsId = Workspaces.idFor(rootPath);
      ws.addToCollection(WATCH_LATER_ID, wsId, 1);
      ws.addToCollection(WATCH_LATER_ID, "ws-kept", 2);

      ws.remove(rootPath);

      const items =
        ws.collections().find((c) => c.id === WATCH_LATER_ID)?.items ?? [];
      expect(items).toEqual([
        expect.objectContaining({ workspaceId: "ws-kept", fileId: 2 }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("lock guards", () => {
  const watchLaterOf = (ws: InstanceType<typeof Workspaces>) =>
    ws.collections().find((c) => c.id === WATCH_LATER_ID);

  it("refuses to remove the collection", () => {
    const ws = new Workspaces();
    ws.removeCollection(WATCH_LATER_ID);

    expect(watchLaterOf(ws)).toBeDefined();
    expect(watchLaterOf(new Workspaces())).toBeDefined();
  });

  it("refuses to rename it", () => {
    const ws = new Workspaces();
    const before = watchLaterOf(ws)?.name;
    ws.renameCollection(WATCH_LATER_ID, "Renamed");

    expect(watchLaterOf(ws)?.name).toBe(before);
  });

  it("refuses to change its emoji", () => {
    const ws = new Workspaces();
    const before = watchLaterOf(ws)?.emoji;
    ws.setCollectionEmoji(WATCH_LATER_ID, "🔥");

    expect(watchLaterOf(ws)?.emoji).toBe(before);
  });

  it("keeps it pinned in front when a reorder tries to move it", () => {
    const ws = new Workspaces();
    const a = ws.addCollection("A");
    const b = ws.addCollection("B");

    // Ask for an order that would push Watch Later to the back.
    ws.reorderCollections([a.id, b.id, WATCH_LATER_ID]);

    expect(ws.collections().map((c) => c.id)).toEqual([
      WATCH_LATER_ID,
      a.id,
      b.id,
    ]);
  });

  it("still reorders user collections around it", () => {
    const ws = new Workspaces();
    const a = ws.addCollection("A");
    const b = ws.addCollection("B");

    ws.reorderCollections([b.id, a.id]);

    expect(ws.collections().map((c) => c.id)).toEqual([
      WATCH_LATER_ID,
      b.id,
      a.id,
    ]);
  });

  it("leaves user collections fully mutable", () => {
    const ws = new Workspaces();
    const mine = ws.addCollection("Mine");

    ws.renameCollection(mine.id, "Renamed");
    expect(ws.collections().find((c) => c.id === mine.id)?.name).toBe(
      "Renamed",
    );

    ws.removeCollection(mine.id);
    expect(ws.collections().find((c) => c.id === mine.id)).toBeUndefined();
  });

  it("still allows adding and removing files (membership is not locked)", () => {
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);
    expect(watchLaterOf(ws)?.items).toHaveLength(1);

    ws.removeFromCollection(WATCH_LATER_ID, "wsA", 1);
    expect(watchLaterOf(ws)?.items).toHaveLength(0);
  });
});

describe("removeFromWatchLater (auto-removal on open)", () => {
  const itemsOf = (ws: InstanceType<typeof Workspaces>, id: string) =>
    ws.collections().find((c) => c.id === id)?.items ?? [];

  it("drops the opened file from the list", () => {
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);
    ws.addToCollection(WATCH_LATER_ID, "wsA", 2);

    expect(ws.removeFromWatchLater("wsA", 1)).toBe(true);
    expect(itemsOf(ws, WATCH_LATER_ID)).toEqual([
      expect.objectContaining({ workspaceId: "wsA", fileId: 2 }),
    ]);
  });

  it("persists the removal across a reload", () => {
    const first = new Workspaces();
    first.addToCollection(WATCH_LATER_ID, "wsA", 1);
    first.removeFromWatchLater("wsA", 1);

    expect(itemsOf(new Workspaces(), WATCH_LATER_ID)).toEqual([]);
  });

  it("reports false when the file was not on the list", () => {
    const ws = new Workspaces();
    expect(ws.removeFromWatchLater("wsA", 999)).toBe(false);
  });

  it("only matches the same workspace, so identical file ids elsewhere stay", () => {
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);
    ws.addToCollection(WATCH_LATER_ID, "wsB", 1);

    expect(ws.removeFromWatchLater("wsA", 1)).toBe(true);
    expect(itemsOf(ws, WATCH_LATER_ID)).toEqual([
      expect.objectContaining({ workspaceId: "wsB", fileId: 1 }),
    ]);
  });

  it("leaves the same file in other collections untouched", () => {
    const ws = new Workspaces();
    const mine = ws.addCollection("Mine");
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);
    ws.addToCollection(mine.id, "wsA", 1);

    ws.removeFromWatchLater("wsA", 1);

    expect(itemsOf(ws, WATCH_LATER_ID)).toEqual([]);
    expect(itemsOf(ws, mine.id)).toEqual([
      expect.objectContaining({ workspaceId: "wsA", fileId: 1 }),
    ]);
  });

  it("lets a deliberate re-add after auto-removal stick", () => {
    // Spec edge case: order decides the outcome. Auto-removal on open followed by
    // an explicit re-add (e.g. from the detail screen) must leave the file listed.
    const ws = new Workspaces();
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);
    ws.removeFromWatchLater("wsA", 1);
    ws.addToCollection(WATCH_LATER_ID, "wsA", 1);

    expect(itemsOf(ws, WATCH_LATER_ID)).toEqual([
      expect.objectContaining({ workspaceId: "wsA", fileId: 1 }),
    ]);
    expect(itemsOf(new Workspaces(), WATCH_LATER_ID)).toHaveLength(1);
  });
});
