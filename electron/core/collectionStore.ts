// User collections, stored in the library's `collections` and
// `collection_items` tables (db.ts) through the same connections as the
// settings (appConfig.ts). Each change writes only its own rows, so adding a
// file costs the same however many files the collections hold. Workspaces
// keeps the collections in memory and calls these after changing them there.
//
// A write that fails (a full disk) is logged rather than thrown, as a setting
// is: the change stays in memory for the session.
import { COLLECTIONS_KEY, isStorageError, withSettings } from "./appConfig.js";
import type { DB } from "./db.js";
import log from "./logger.js";
import { libraryDbPath } from "./paths.js";

// The library whose collections could not be read at startup: nothing is
// written to it for the session, since writes made on the empty list served
// instead (Watch Later seeded again, a new order) would land among the
// collections it could not show.
let unreadable: string | null = null;

export interface UserCollectionItemConfig {
  workspaceId: string;
  fileId: number;
  addedAt: number;
}

export interface UserCollectionConfig {
  id: string;
  name: string;
  /** Optional emoji icon; falls back to the folder icon when unset. */
  emoji?: string;
  /** In the collection's manual order. */
  items: UserCollectionItemConfig[];
  createdAt: number;
  updatedAt: number;
  /**
   * Built-in collections (currently only "Watch Later") set this. Locked
   * collections can still gain and lose files, and their files can still be
   * rearranged, but the collection itself cannot be removed, renamed, re-iconed
   * or repositioned among the collections. Absent/false on every user-created one.
   */
  locked?: boolean;
}

/** A file in a collection: the workspace it is in and its id there. */
export interface FileRef {
  workspaceId: string;
  fileId: number;
}

/** Run a write; a storage error is logged, anything else is a bug. */
function write(what: string, fn: (db: DB) => void): void {
  if (unreadable === libraryDbPath()) return; // see loadCollections
  try {
    withSettings((db) => db.transaction(() => fn(db)).immediate());
  } catch (e) {
    if (!isStorageError(e)) throw e;
    log.error(`${what} was not saved`, e);
  }
}

/**
 * The collections, in order, each with its items in order. Moves what an
 * earlier version kept in app_settings into the tables first (migrateRow).
 * Empty when the settings cannot be read (see appConfig.ts).
 */
export function loadCollections(): UserCollectionConfig[] {
  const file = libraryDbPath();
  try {
    const collections = withSettings(read)?.value ?? [];
    if (unreadable === file) unreadable = null;
    return collections;
  } catch (e) {
    if (!isStorageError(e)) throw e;
    log.error("the collections could not be read; not writing them", e);
    unreadable = file;
    return [];
  }
}

function read(db: DB): UserCollectionConfig[] {
  // The write lock only when there is something to move: otherwise a launch
  // would wait on any other writer just to read.
  if (
    db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(COLLECTIONS_KEY)
  ) {
    db.transaction(() => migrateRow(db)).immediate();
  }
  const rows = db
    .prepare(
      "SELECT id, name, emoji, locked, created_at, updated_at FROM collections ORDER BY position, rowid",
    )
    .all() as {
    id: string;
    name: string;
    emoji: string | null;
    locked: number;
    created_at: number;
    updated_at: number;
  }[];
  const items = new Map<string, UserCollectionItemConfig[]>(
    rows.map((r) => [r.id, []]),
  );
  const itemRows = db
    .prepare(
      "SELECT collection_id, workspace_id, file_id, added_at FROM collection_items ORDER BY collection_id, position, rowid",
    )
    .all() as {
    collection_id: string;
    workspace_id: string;
    file_id: number;
    added_at: number;
  }[];
  for (const r of itemRows) {
    items.get(r.collection_id)?.push({
      workspaceId: r.workspace_id,
      fileId: r.file_id,
      addedAt: r.added_at,
    });
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ...(r.emoji ? { emoji: r.emoji } : {}),
    items: items.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.locked === 1 ? { locked: true } : {}),
  }));
}

/**
 * Move the collections an earlier version kept as one JSON row of
 * app_settings (COLLECTIONS_KEY, also where config.json's are imported to)
 * into the tables, and drop the row: in the caller's transaction, so it runs
 * once. The row replaces what the tables hold: it is only there when they
 * have not been written since (a fresh import, or a library put back from a
 * copy taken before the tables). A row that is not a list is dropped and the
 * tables kept.
 */
function migrateRow(db: DB): void {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(COLLECTIONS_KEY) as { value: string } | undefined;
  if (!row) return;
  const drop = db.prepare("DELETE FROM app_settings WHERE key = ?");
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = undefined;
  }
  // Not a list (a hand edit, a damaged value): nothing to move, and nothing to
  // replace the stored collections with.
  if (!Array.isArray(parsed)) {
    log.warn("the collections to move are not a list; keeping those stored");
    drop.run(COLLECTIONS_KEY);
    return;
  }
  const collections = parseCollections(parsed);
  db.prepare("DELETE FROM collections").run();
  insertCollections(db, collections);
  drop.run(COLLECTIONS_KEY);
  log.info(`moved ${collections.length} collections into their tables`);
}

function insertCollections(
  db: DB,
  collections: readonly UserCollectionConfig[],
): void {
  const putCollection = db.prepare(
    "INSERT OR IGNORE INTO collections (id, name, emoji, locked, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const putItem = db.prepare(
    "INSERT OR IGNORE INTO collection_items (collection_id, workspace_id, file_id, position, added_at) VALUES (?, ?, ?, ?, ?)",
  );
  collections.forEach((c, position) => {
    putCollection.run(
      c.id,
      c.name,
      c.emoji ?? null,
      c.locked === true ? 1 : 0,
      position,
      c.createdAt,
      c.updatedAt,
    );
    c.items.forEach((item, i) =>
      putItem.run(c.id, item.workspaceId, item.fileId, i, item.addedAt),
    );
  });
}

/** Collections as stored in JSON (config.json, or app_settings before the
 *  tables), entry by entry: one that does not validate is left out. */
export function parseCollections(value: unknown): UserCollectionConfig[] {
  if (!Array.isArray(value)) return [];
  const out: UserCollectionConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.name !== "string") continue;
    const items: UserCollectionItemConfig[] = [];
    if (Array.isArray(c.items)) {
      for (const itemRaw of c.items) {
        if (!itemRaw || typeof itemRaw !== "object") continue;
        const item = itemRaw as Record<string, unknown>;
        if (
          typeof item.workspaceId !== "string" ||
          typeof item.fileId !== "number"
        )
          continue;
        items.push({
          workspaceId: item.workspaceId,
          fileId: item.fileId,
          addedAt: typeof item.addedAt === "number" ? item.addedAt : 0,
        });
      }
    }
    out.push({
      id: c.id,
      name: c.name,
      emoji: typeof c.emoji === "string" && c.emoji ? c.emoji : undefined,
      items,
      createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
      updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
      ...(c.locked === true ? { locked: true } : {}),
    });
  }
  return out;
}

/** Add a collection, with its items, and store the order of all of them. */
export function insertCollection(
  collection: UserCollectionConfig,
  order: readonly string[],
): void {
  write("a new collection", (db) => {
    insertCollections(db, [collection]);
    setOrder(db, order);
  });
}

/** Store a collection's name, emoji, lock and updatedAt. */
export function updateCollection(collection: UserCollectionConfig): void {
  write("a collection change", (db) => {
    db.prepare(
      "UPDATE collections SET name = ?, emoji = ?, locked = ?, updated_at = ? WHERE id = ?",
    ).run(
      collection.name,
      collection.emoji ?? null,
      collection.locked === true ? 1 : 0,
      collection.updatedAt,
      collection.id,
    );
  });
}

/** Remove a collection and its items. */
export function deleteCollection(id: string): void {
  write("removing a collection", (db) => {
    db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  });
}

/** Store the order of the collections, given as every id in order. */
export function setCollectionOrder(order: readonly string[]): void {
  write("the order of the collections", (db) => setOrder(db, order));
}

function setOrder(db: DB, order: readonly string[]): void {
  const put = db.prepare("UPDATE collections SET position = ? WHERE id = ?");
  order.forEach((id, position) => put.run(position, id));
}

/** Append items to a collection, after the ones it holds, in the order given. */
export function addItems(
  collectionId: string,
  items: readonly UserCollectionItemConfig[],
  updatedAt: number,
): void {
  write("adding to a collection", (db) => {
    const { next } = db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM collection_items WHERE collection_id = ?",
      )
      .get(collectionId) as { next: number };
    const put = db.prepare(
      "INSERT OR IGNORE INTO collection_items (collection_id, workspace_id, file_id, position, added_at) VALUES (?, ?, ?, ?, ?)",
    );
    items.forEach((item, i) =>
      put.run(
        collectionId,
        item.workspaceId,
        item.fileId,
        next + i,
        item.addedAt,
      ),
    );
    touch(db, collectionId, updatedAt);
  });
}

/** Remove items from a collection. */
export function removeItems(
  collectionId: string,
  refs: readonly FileRef[],
  updatedAt: number,
): void {
  write("removing from a collection", (db) => {
    const drop = db.prepare(
      "DELETE FROM collection_items WHERE collection_id = ? AND workspace_id = ? AND file_id = ?",
    );
    for (const ref of refs) drop.run(collectionId, ref.workspaceId, ref.fileId);
    touch(db, collectionId, updatedAt);
  });
}

/**
 * Remove a workspace's items from every collection: the ones of `fileIds`,
 * or all of them when it is null. `updatedAt`, when given, is set on each
 * collection that held one.
 */
export function removeWorkspaceItems(
  workspaceId: string,
  fileIds: readonly number[] | null,
  updatedAt: number | null,
): void {
  write("removing files from the collections", (db) => {
    if (fileIds === null) {
      if (updatedAt !== null) {
        db.prepare(
          "UPDATE collections SET updated_at = ? WHERE id IN (SELECT collection_id FROM collection_items WHERE workspace_id = ?)",
        ).run(updatedAt, workspaceId);
      }
      db.prepare("DELETE FROM collection_items WHERE workspace_id = ?").run(
        workspaceId,
      );
      return;
    }
    const touchFor = db.prepare(
      "UPDATE collections SET updated_at = ? WHERE id IN (SELECT collection_id FROM collection_items WHERE workspace_id = ? AND file_id = ?)",
    );
    const drop = db.prepare(
      "DELETE FROM collection_items WHERE workspace_id = ? AND file_id = ?",
    );
    for (const fileId of fileIds) {
      if (updatedAt !== null) touchFor.run(updatedAt, workspaceId, fileId);
      drop.run(workspaceId, fileId);
    }
  });
}

/**
 * Store a rearrangement of some of a collection's items: `moved`, in their
 * new order, take the places they held between them, in order. Only their
 * rows are written; every other item keeps its place.
 */
export function moveItems(
  collectionId: string,
  moved: readonly FileRef[],
  updatedAt: number,
): void {
  write("the order of a collection", (db) => {
    const get = db.prepare(
      "SELECT position FROM collection_items WHERE collection_id = ? AND workspace_id = ? AND file_id = ?",
    );
    const places = moved
      .map(
        (ref) =>
          (
            get.get(collectionId, ref.workspaceId, ref.fileId) as
              { position: number } | undefined
          )?.position,
      )
      .filter((p): p is number => p !== undefined)
      .sort((a, b) => a - b);
    // Only after an earlier write failed: the stored collection is not the
    // one in memory, and its order is left as it was.
    if (places.length !== moved.length) {
      log.warn("a moved item is not in the stored collection; order not saved");
      return;
    }
    const put = db.prepare(
      "UPDATE collection_items SET position = ? WHERE collection_id = ? AND workspace_id = ? AND file_id = ?",
    );
    moved.forEach((ref, i) =>
      put.run(places[i], collectionId, ref.workspaceId, ref.fileId),
    );
    touch(db, collectionId, updatedAt);
  });
}

function touch(db: DB, collectionId: string, updatedAt: number): void {
  db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(
    updatedAt,
    collectionId,
  );
}
