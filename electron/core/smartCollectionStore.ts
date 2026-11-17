// Smart collections (saved searches), stored in the library's
// `smart_collections` table (db.ts) through the same connections as the
// settings (appConfig.ts), so they share the library's backups and restore.
// Each change writes only its own rows.
//
// Unlike a setting, a write that fails throws: the renderer shows the change
// only once it is stored, and tells the user when it was not.
import {
  SmartCollectionSchema,
  type SmartCollection,
  type StoredSmartCollections,
} from "../../shared/ipc/schema.js";
import { withSettings } from "./appConfig.js";
import type { DB } from "./db.js";
import log from "./logger.js";

/**
 * The row that records the renderer's localStorage as moved in: after it,
 * localStorage is never read again. A library put back from a copy taken
 * before the move has no record of it, and moves them in again.
 */
export const SMART_COLLECTIONS_IMPORTED_KEY = "_smart_collections_imported_at";

/** In the library, or blocked for the session (see appConfig's openStore). */
function run<T>(fn: (db: DB) => T): T {
  const done = withSettings(fn);
  if (done === null) {
    throw new Error("the library could not be read at startup");
  }
  return done.value;
}

function write(fn: (db: DB) => void): StoredSmartCollections {
  return run((db) => {
    db.transaction(() => fn(db)).immediate();
    return read(db);
  });
}

/**
 * The saved searches, and whether localStorage's still need moving in.
 * Empty, with nothing to move, when the library is blocked for the session:
 * an import there would be written over what could not be read.
 */
export function listSmartCollections(): StoredSmartCollections & {
  needsImport: boolean;
} {
  const listed = withSettings((db) => ({
    ...read(db),
    needsImport: !imported(db),
  }));
  return (
    listed?.value ?? { collections: [], defaultId: null, needsImport: false }
  );
}

function imported(db: DB): boolean {
  return (
    db
      .prepare("SELECT 1 FROM app_settings WHERE key = ?")
      .get(SMART_COLLECTIONS_IMPORTED_KEY) !== undefined
  );
}

function read(db: DB): StoredSmartCollections {
  const rows = db
    .prepare(
      "SELECT id, name, query, workspace_id, is_default, created_at, updated_at FROM smart_collections ORDER BY position, rowid",
    )
    .all() as {
    id: string;
    name: string;
    query: string;
    workspace_id: string | null;
    is_default: number;
    created_at: number;
    updated_at: number;
  }[];
  const collections: SmartCollection[] = [];
  let defaultId: string | null = null;
  // Entry by entry, so one that does not validate leaves the rest.
  for (const r of rows) {
    let query: unknown;
    try {
      query = JSON.parse(r.query);
    } catch {
      query = undefined;
    }
    const parsed = SmartCollectionSchema.safeParse({
      id: r.id,
      name: r.name,
      query,
      ...(r.workspace_id !== null ? { workspaceId: r.workspace_id } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
    if (!parsed.success) {
      log.warn(
        `the smart collection ${r.id} could not be parsed; leaving it out`,
      );
      continue;
    }
    collections.push(parsed.data);
    if (r.is_default === 1) defaultId = r.id;
  }
  return { collections, defaultId };
}

function insert(db: DB, collection: SmartCollection, position: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO smart_collections (id, name, query, workspace_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    collection.id,
    collection.name,
    JSON.stringify(collection.query),
    collection.workspaceId ?? null,
    position,
    collection.createdAt,
    collection.updatedAt,
  );
}

function setDefault(db: DB, id: string | null): void {
  db.prepare(
    "UPDATE smart_collections SET is_default = 0 WHERE is_default = 1",
  ).run();
  if (id !== null) {
    db.prepare("UPDATE smart_collections SET is_default = 1 WHERE id = ?").run(
      id,
    );
  }
}

/**
 * Move in what an earlier version kept in localStorage, once: recorded in the
 * same transaction. When the library already holds saved searches (another
 * run moved them in, or they were added since), those are kept.
 */
export function importSmartCollections(
  collections: readonly SmartCollection[],
  defaultId: string | null,
): StoredSmartCollections {
  return write((db) => {
    if (imported(db)) return;
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM smart_collections")
      .get() as { n: number };
    if (n === 0) {
      collections.forEach((c, position) => insert(db, c, position));
      // An id that was not moved in (a deleted collection) is no default.
      setDefault(db, defaultId);
      if (collections.length > 0) {
        log.info(
          `moved ${collections.length} smart collections into the library`,
        );
      }
    }
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(
      SMART_COLLECTIONS_IMPORTED_KEY,
      JSON.stringify(Date.now()),
    );
  });
}

/** Add a saved search before every other one. */
export function addSmartCollection(
  collection: SmartCollection,
): StoredSmartCollections {
  return write((db) => {
    const { first } = db
      .prepare(
        "SELECT COALESCE(MIN(position), 0) AS first FROM smart_collections",
      )
      .get() as { first: number };
    insert(db, collection, first - 1);
  });
}

/** Remove a saved search; it stops being the default with it. */
export function removeSmartCollection(id: string): StoredSmartCollections {
  return write((db) => {
    db.prepare("DELETE FROM smart_collections WHERE id = ?").run(id);
  });
}

/** Make a saved search the default, or (null) none of them. */
export function setDefaultSmartCollection(
  id: string | null,
): StoredSmartCollections {
  return write((db) => setDefault(db, id));
}
