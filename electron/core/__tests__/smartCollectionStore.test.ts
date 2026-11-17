// Smart collections in the library (smartCollectionStore.ts): what is stored
// reads back, localStorage's move in once without overwriting the library's,
// and an entry that does not validate leaves the rest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmartCollection } from "../../../shared/ipc/schema.js";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const store = await import("../smartCollectionStore.js");
const { openSettingsDb } = await import("../db.js");

const libraryFile = () => path.join(userData, "library.sqlite");

function exec(sql: string, ...params: unknown[]): void {
  const db = openSettingsDb(libraryFile());
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

const make = (id: string, extra: Partial<SmartCollection> = {}) =>
  ({
    id,
    name: `Search ${id}`,
    query: { kind: "video" },
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  }) satisfies SmartCollection;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-smart-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("stored smart collections", () => {
  it("ask for localStorage's on a fresh library", () => {
    expect(store.listSmartCollections()).toEqual({
      collections: [],
      defaultId: null,
      needsImport: true,
    });
  });

  it("read back newest first, with the default", () => {
    store.importSmartCollections([], null);
    const folder = make("a", {
      query: { kind: "video", folder: { path: "x/y", recursive: true } },
      workspaceId: "ws1",
    });
    store.addSmartCollection(folder);
    store.addSmartCollection(make("b"));
    store.setDefaultSmartCollection("a");

    expect(store.listSmartCollections()).toEqual({
      collections: [make("b"), folder],
      defaultId: "a",
      needsImport: false,
    });
  });

  it("keep one default, and drop it with its collection", () => {
    store.addSmartCollection(make("a"));
    store.addSmartCollection(make("b"));
    store.setDefaultSmartCollection("a");
    expect(store.setDefaultSmartCollection("b").defaultId).toBe("b");
    expect(store.removeSmartCollection("b")).toEqual({
      collections: [make("a")],
      defaultId: null,
    });
    store.setDefaultSmartCollection("a");
    expect(store.setDefaultSmartCollection(null).defaultId).toBeNull();
  });

  it("leave out an entry that does not validate", () => {
    store.addSmartCollection(make("a"));
    store.addSmartCollection(make("b"));
    exec("UPDATE smart_collections SET query = ? WHERE id = ?", "{oops", "a");
    expect(store.listSmartCollections().collections).toEqual([make("b")]);
  });
});

describe("moving localStorage's in", () => {
  it("stores them in their order, with the default, once", () => {
    const moved = store.importSmartCollections([make("a"), make("b")], "b");
    expect(moved).toEqual({
      collections: [make("a"), make("b")],
      defaultId: "b",
    });
    expect(store.listSmartCollections().needsImport).toBe(false);

    // A second run (an older window) changes nothing.
    store.removeSmartCollection("a");
    expect(store.importSmartCollections([make("a")], "a")).toEqual({
      collections: [make("b")],
      defaultId: "b",
    });
  });

  it("keeps the saved searches the library already holds", () => {
    store.addSmartCollection(make("kept"));
    expect(store.importSmartCollections([make("a")], "a")).toEqual({
      collections: [make("kept")],
      defaultId: null,
    });
  });

  it("drops a default that was not moved in", () => {
    expect(store.importSmartCollections([make("a")], "gone").defaultId).toBe(
      null,
    );
  });
});

describe("a write that fails", () => {
  it("throws, so the renderer can say so", () => {
    store.addSmartCollection(make("a"));
    // A trigger that refuses the insert stands in for a full disk.
    exec(
      "CREATE TRIGGER no_insert BEFORE INSERT ON smart_collections BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => store.addSmartCollection(make("b"))).toThrow(/disk full/);
    expect(store.listSmartCollections().collections).toEqual([make("a")]);
  });
});
