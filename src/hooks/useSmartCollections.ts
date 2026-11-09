import { useMemo, useSyncExternalStore } from "react";
import type { SearchQuery } from "@/ipc/types";
import {
  DEFAULT_SMART_COLLECTION_KEY,
  SMART_COLLECTIONS_KEY,
  defaultQueryOf,
  makeSmartCollection,
  parseSmartCollections,
  saveDefaultSmartCollectionId,
  saveSmartCollections,
  type SmartCollection,
} from "@/lib/smartCollections";

interface Snapshot {
  collections: SmartCollection[];
  defaultId: string | null;
  raw: string | null;
  defaultRaw: string | null;
}

let snapshot: Snapshot | undefined;
const listeners = new Set<() => void>();

function readStorage(): Pick<Snapshot, "raw" | "defaultRaw"> {
  try {
    return {
      raw: localStorage.getItem(SMART_COLLECTIONS_KEY),
      defaultRaw: localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY),
    };
  } catch {
    return {
      raw: snapshot?.raw ?? null,
      defaultRaw: snapshot?.defaultRaw ?? null,
    };
  }
}

function getSnapshot(): Snapshot {
  const stored = readStorage();
  if (
    !snapshot ||
    snapshot.raw !== stored.raw ||
    snapshot.defaultRaw !== stored.defaultRaw
  ) {
    snapshot = {
      ...stored,
      collections: parseSmartCollections(stored.raw),
      defaultId: stored.defaultRaw || null,
    };
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function commit(collections: SmartCollection[], defaultId: string | null) {
  saveSmartCollections(collections);
  saveDefaultSmartCollectionId(defaultId);
  // Keep the in-memory values if storage is unavailable. Each subscriber reads
  // one shared snapshot, so the rail and saved-filter menu cannot overwrite
  // each other's changes.
  snapshot = { collections, defaultId, ...readStorage() };
  listeners.forEach((listener) => listener());
}

function addCollection(
  name: string,
  query: SearchQuery,
  workspaceId?: string | null,
  scope?: SmartCollection["scope"],
) {
  const collection = makeSmartCollection(name, query, workspaceId, scope);
  const current = getSnapshot();
  commit([collection, ...current.collections], current.defaultId);
  return collection;
}

function updateCollection(collection: SmartCollection) {
  const current = getSnapshot();
  commit(
    current.collections.map((c) => (c.id === collection.id ? collection : c)),
    current.defaultId,
  );
}

function removeCollection(id: string) {
  const current = getSnapshot();
  commit(
    current.collections.filter((c) => c.id !== id),
    current.defaultId === id ? null : current.defaultId,
  );
}

function setDefaultId(id: string | null) {
  commit(getSnapshot().collections, id);
}

export function useSmartCollections() {
  const { collections, defaultId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
  );
  const defaultQuery = useMemo(
    () => defaultQueryOf(collections, defaultId),
    [collections, defaultId],
  );
  return {
    collections,
    defaultId,
    defaultQuery,
    addCollection,
    updateCollection,
    removeCollection,
    setDefaultId,
  };
}

export type SmartCollectionsState = ReturnType<typeof useSmartCollections>;
