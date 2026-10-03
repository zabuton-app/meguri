import { useCallback, useMemo, useState } from "react";
import type { SearchQuery } from "@/ipc/types";
import {
  defaultQueryOf,
  loadDefaultSmartCollectionId,
  makeSmartCollection,
  parseSmartCollections,
  saveDefaultSmartCollectionId,
  saveSmartCollections,
  SMART_COLLECTIONS_KEY,
  type SmartCollection,
} from "@/lib/smartCollections";

export function useSmartCollections() {
  const [collections, setCollections] = useState<SmartCollection[]>(() => {
    try {
      return parseSmartCollections(localStorage.getItem(SMART_COLLECTIONS_KEY));
    } catch {
      return [];
    }
  });

  // Not useLocalStorage: that stores null as the string "null" rather than
  // removing the key, which loadInitialFilter would then read as an id.
  const [defaultId, setDefaultIdState] = useState<string | null>(
    loadDefaultSmartCollectionId,
  );

  const setDefaultId = useCallback((id: string | null) => {
    setDefaultIdState(id);
    saveDefaultSmartCollectionId(id);
  }, []);

  // Functional updates so back-to-back calls within one render compose off the
  // latest state instead of a stale closure snapshot.
  const persist = useCallback(
    (update: (prev: SmartCollection[]) => SmartCollection[]) => {
      setCollections((prev) => {
        const next = update(prev);
        saveSmartCollections(next);
        return next;
      });
    },
    [],
  );

  const addCollection = useCallback(
    (name: string, query: SearchQuery, workspaceId?: string | null) => {
      const collection = makeSmartCollection(name, query, workspaceId);
      persist((prev) => [collection, ...prev]);
      return collection;
    },
    [persist],
  );

  const removeCollection = useCallback(
    (id: string) => {
      persist((prev) => prev.filter((collection) => collection.id !== id));
      // A deleted collection cannot stay the default.
      if (id === defaultId) setDefaultId(null);
    },
    [persist, defaultId, setDefaultId],
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
    removeCollection,
    setDefaultId,
  };
}

export type SmartCollectionsState = ReturnType<typeof useSmartCollections>;
