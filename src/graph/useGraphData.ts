// The graph's data for a scope and query, and the scope's cached layout, read
// side by side so the first frame can use both.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import type { Point } from "./model/placement";

/** Stands in for the cache when it cannot be read: one instance, so the
 *  view's effect does not see a new cache on every render. */
const NO_CACHE = new Map<string, Point>();

/** Parts of a query the graph ignores; dropped so they do not refetch it. */
function graphQuery(query: SearchQuery): SearchQuery {
  const q = { ...query };
  delete q.cursor;
  delete q.limit;
  delete q.folder;
  return q;
}

export function useGraphData(
  scope: string,
  query: SearchQuery,
  enabled: boolean,
) {
  const q = graphQuery(query);
  const graph = useQuery({
    queryKey: ["graph_build", scope, q],
    queryFn: () => api.graphBuild(q),
    enabled,
    // Thousands of array entries to diff for nothing: every payload builds a
    // new graph anyway.
    structuralSharing: false,
  });
  const layout = useQuery({
    queryKey: ["graph_layout", scope],
    queryFn: async () => {
      const stored = await api.graphLayoutGet(scope);
      const out = new Map<string, Point>();
      stored?.keys.forEach((k, i) =>
        out.set(k, [stored.xy[i * 2], stored.xy[i * 2 + 1]]),
      );
      return out;
    },
    enabled,
    // Read once per mount: afterwards the positions on screen are newer.
    staleTime: Infinity,
    gcTime: 0,
  });
  return {
    payload: graph.data,
    cache: layout.data ?? (layout.isError ? NO_CACHE : undefined),
    isLoading: graph.isLoading || layout.isLoading,
    isError: graph.isError,
  };
}
