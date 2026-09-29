// The graph's data for a scope and query, and the scope's cached layout, read
// side by side so the first frame can use both.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { GRAPH_SIZED_BY_PLAYS } from "@/lib/queryCache";
import type { SearchQuery } from "@/ipc/types";
import type { GraphDims } from "@shared/ipc/graph";
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
  /** Nodes are sized by plays, so a recorded play refreshes the payload. */
  sizedByPlays = false,
  /** Which layout cache to read: the flat view's or the 3D one's. */
  dims: GraphDims = 2,
) {
  const q = graphQuery(query);
  const graph = useQuery({
    queryKey: ["graph_build", scope, q],
    queryFn: () => api.graphBuild(q),
    enabled,
    meta: { [GRAPH_SIZED_BY_PLAYS]: sizedByPlays },
    // Thousands of array entries to diff for nothing: every payload builds a
    // new graph anyway.
    structuralSharing: false,
  });
  // Plays recorded while nodes were sized by links did not refresh the
  // payload: switching to plays fetches fresh counts (and so takes the new
  // meta, which a query only picks up when it fetches).
  const { refetch } = graph;
  const wasByPlays = useRef(sizedByPlays);
  useEffect(() => {
    if (sizedByPlays && !wasByPlays.current && enabled) void refetch();
    wasByPlays.current = sizedByPlays;
  }, [sizedByPlays, enabled, refetch]);
  const layout = useQuery({
    queryKey: ["graph_layout", scope, dims],
    queryFn: async () => {
      const stored = await api.graphLayoutGet(scope, dims);
      const out = new Map<string, Point>();
      stored?.keys.forEach((k, i) =>
        out.set(k, stored.xy.slice(i * dims, (i + 1) * dims)),
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
