import { useCallback, useState } from "react";
import type { SearchQuery } from "@/ipc/types";
import {
  makeSmartCollection,
  parseSmartCollections,
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
    (name: string, query: SearchQuery) => {
      const collection = makeSmartCollection(name, query);
      persist((prev) => [collection, ...prev]);
      return collection;
    },
    [persist],
  );

  const removeCollection = useCallback(
    (id: string) => {
      persist((prev) => prev.filter((collection) => collection.id !== id));
    },
    [persist],
  );

  return { collections, addCollection, removeCollection };
}
