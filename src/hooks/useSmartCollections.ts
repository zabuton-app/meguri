import { useCallback, useMemo } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import type { StoredSmartCollections } from "@shared/ipc/schema";
import {
  defaultQueryOf,
  makeSmartCollection,
  readLegacySmartCollections,
  type SmartCollection,
} from "@/lib/smartCollections";

/**
 * The saved searches, from the library. Changed only through the mutations
 * below, each of which answers with the stored state, so it never goes stale.
 * renderApp loads it before the first render: the list opens on the default
 * one (initialFilter) and the menu never shows empty while it loads.
 */
export const smartCollectionsQuery = queryOptions({
  queryKey: ["smart_collections"],
  queryFn: loadSmartCollections,
  staleTime: Infinity,
});

async function loadSmartCollections(): Promise<StoredSmartCollections> {
  const { needsImport, ...state } = await api.smartCollectionsList();
  if (!needsImport) return state;
  // The first launch since they moved into the library: bring over what
  // localStorage holds, once.
  const legacy = readLegacySmartCollections();
  if (!legacy) return state;
  return api.smartCollectionsImport(legacy.collections, legacy.defaultId);
}

/**
 * The filter the list starts with: the default saved search, or nothing.
 * Read from the cache renderApp filled, so it is there at the first render.
 */
export function initialFilter(qc: QueryClient): SearchQuery {
  const state = qc.getQueryData(smartCollectionsQuery.queryKey);
  return state
    ? (defaultQueryOf(state.collections, state.defaultId) ?? {})
    : {};
}

const NONE: SmartCollection[] = [];

export function useSmartCollections() {
  const qc = useQueryClient();
  const { data } = useQuery(smartCollectionsQuery);
  const collections = data?.collections ?? NONE;
  const defaultId = data?.defaultId ?? null;

  // A failed write leaves the list as it was, and the generic toast
  // (useMutationErrorNotifier) says so.
  const stored = useCallback(
    (state: StoredSmartCollections) =>
      qc.setQueryData(smartCollectionsQuery.queryKey, state),
    [qc],
  );
  const { mutate: add } = useMutation({
    mutationFn: api.smartCollectionAdd,
    onSuccess: stored,
  });
  const { mutate: remove } = useMutation({
    mutationFn: api.smartCollectionRemove,
    onSuccess: stored,
  });
  const { mutate: setDefault } = useMutation({
    mutationFn: api.smartCollectionSetDefault,
    onSuccess: stored,
  });

  const addCollection = useCallback(
    (name: string, query: SearchQuery, workspaceId?: string | null) => {
      const collection = makeSmartCollection(name, query, workspaceId);
      add(collection);
      return collection;
    },
    [add],
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
    removeCollection: remove,
    setDefaultId: setDefault,
  };
}

export type SmartCollectionsState = ReturnType<typeof useSmartCollections>;
