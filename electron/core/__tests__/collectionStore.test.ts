// Collections in their own tables (collectionStore.ts): what is stored matches
// what Workspaces holds, each change writes only its rows, and collections kept
// as one JSON row (config.json's import, or an earlier build) move in once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");
const { WATCH_LATER_ID } = await import("../../../shared/workspaceIds.js");
const { COLLECTIONS_KEY } = await import("../appConfig.js");
const { loadCollections } = await import("../collectionStore.js");
const { openSettingsDb } = await import("../db.js");
const { writeStoredSettings } = await import("./storedSettings.js");

const libraryFile = () => path.join(userData, "library.sqlite");

function query<T>(sql: string, ...params: unknown[]): T[] {
  const db = openSettingsDb(libraryFile());
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const positions = (collectionId: string) =>
  new Map(
    query<{ file_id: number; position: number }>(
      "SELECT file_id, position FROM collection_items WHERE collection_id = ?",
      collectionId,
    ).map((r) => [r.file_id, r.position]),
  );

/** What a fresh start reads, in the shape Workspaces serves. */
const reloaded = () => new Workspaces().collections();

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-collections-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("stored collections", () => {
  it("read back as Workspaces holds them after every kind of change", () => {
    const ws = new Workspaces();
    const a = ws.addCollection("A", "🎬");
    const b = ws.addCollection("B");
    ws.updateCollectionMembership(
      a.id,
      [1, 2, 3, 4, 5].map((fileId) => ({ workspaceId: "w1", fileId })),
      "add",
    );
    ws.addToCollection(a.id, "w2", 9);
    ws.addToCollection(b.id, "w1", 2);
    ws.addToCollection(WATCH_LATER_ID, "w1", 3);
    ws.removeFromCollection(a.id, "w1", 1);
    ws.updateCollectionMembership(
      a.id,
      [{ workspaceId: "w1", fileId: 5 }],
      "remove",
    );
    ws.reorderCollectionItems(a.id, [
      { workspaceId: "w2", fileId: 9 },
      { workspaceId: "w1", fileId: 2 },
    ]);
    ws.renameCollection(b.id, "Bee");
    ws.setCollectionEmoji(a.id, null);
    ws.reorderCollections([b.id, a.id]);
    ws.removeFromWatchLater("w1", 3);
    ws.removeFilesFromAllCollections("w1", [4]);

    expect(reloaded()).toEqual(ws.collections());
    expect(ws.collections().map((c) => c.name)).toEqual([
      "Watch Later",
      "Bee",
      "A",
    ]);
    expect(
      ws.collections()[2].items.map((i) => `${i.workspaceId}:${i.fileId}`),
    ).toEqual(["w2:9", "w1:3", "w1:2"]);
  });

  it("moves only the rearranged items' rows", () => {
    const ws = new Workspaces();
    const c = ws.addCollection("Mix");
    for (const fileId of [1, 2, 3, 4, 5]) ws.addToCollection(c.id, "w", fileId);
    const before = positions(c.id);

    ws.reorderCollectionItems(c.id, [
      { workspaceId: "w", fileId: 4 },
      { workspaceId: "w", fileId: 2 },
    ]);

    const after = positions(c.id);
    for (const unmoved of [1, 3, 5]) {
      expect(after.get(unmoved)).toBe(before.get(unmoved));
    }
    expect(after.get(4)).toBe(before.get(2));
    expect(after.get(2)).toBe(before.get(4));
  });

  it("removes a collection's items with it", () => {
    const ws = new Workspaces();
    const c = ws.addCollection("Gone");
    ws.addToCollection(c.id, "w", 1);
    ws.removeCollection(c.id);
    expect(
      query("SELECT 1 FROM collection_items WHERE collection_id = ?", c.id),
    ).toEqual([]);
  });

  it("drops a removed workspace's items everywhere", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-coll-root-"));
    try {
      const ws = new Workspaces();
      const rootPath = ws.add(root);
      const id = Workspaces.idFor(rootPath);
      const c = ws.addCollection("Mix");
      ws.addToCollection(c.id, id, 1);
      ws.addToCollection(c.id, "other", 2);
      ws.remove(rootPath);
      ws.closeAll();

      const items = reloaded().find((x) => x.id === c.id)?.items ?? [];
      expect(items).toEqual([
        expect.objectContaining({ workspaceId: "other", fileId: 2 }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("collections kept as one JSON row", () => {
  const legacy = [
    {
      id: WATCH_LATER_ID,
      name: "Watch Later",
      emoji: "🕒",
      items: [{ workspaceId: "w", fileId: 3, addedAt: 30 }],
      createdAt: 1,
      updatedAt: 2,
      locked: true,
    },
    {
      id: "c1",
      name: "Mine",
      items: [
        { workspaceId: "w", fileId: 2, addedAt: 20 },
        { workspaceId: "w", fileId: 1, addedAt: 10 },
      ],
      createdAt: 3,
      updatedAt: 4,
    },
  ];

  it("move into the tables once, in their order", () => {
    writeStoredSettings(userData, { [COLLECTIONS_KEY]: legacy });

    const collections = loadCollections();
    expect(collections.map((c) => c.id)).toEqual([WATCH_LATER_ID, "c1"]);
    expect(collections[1].items.map((i) => i.fileId)).toEqual([2, 1]);
    expect(collections[1]).toMatchObject({ createdAt: 3, updatedAt: 4 });
    expect(collections[0].locked).toBe(true);
    expect(
      query("SELECT 1 FROM app_settings WHERE key = ?", COLLECTIONS_KEY),
    ).toEqual([]);

    // Not moved again: a change made since stays.
    const ws = new Workspaces();
    ws.removeCollection("c1");
    expect(loadCollections().map((c) => c.id)).toEqual([WATCH_LATER_ID]);
  });

  it("come in from config.json through the import", () => {
    fs.writeFileSync(
      path.join(userData, "config.json"),
      JSON.stringify({ roots: [], collections: legacy }),
    );
    const ws = new Workspaces();
    expect(ws.collections().map((c) => c.name)).toEqual([
      "Watch Later",
      "Mine",
    ]);
    expect(reloaded()).toEqual(ws.collections());
  });
});
