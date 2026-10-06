// The timeline's day counts for a scope, query and axis.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import type { TimelineAxis } from "@shared/ipc/timeline";

/** Parts of a query the counts ignore; dropped so they do not refetch them. */
function countsQuery(query: SearchQuery): SearchQuery {
  const q = { ...query };
  delete q.cursor;
  delete q.limit;
  delete q.sort;
  delete q.sortDir;
  return q;
}

export function useTimelineCounts({
  scope,
  query,
  axis,
  enabled,
}: {
  scope: string;
  query: SearchQuery;
  axis: TimelineAxis;
  enabled: boolean;
}) {
  const q = countsQuery(query);
  return useQuery({
    // Scope and filter sit where files_search keeps them, so the cache
    // helpers in queryCache.ts read both keys the same way.
    queryKey: ["timeline_counts", scope, q, axis],
    queryFn: () => api.timelineCounts({ query: q, axis }),
    enabled,
    // A rescan or an edit recounts the days; the sections on screen stay
    // until the new counts arrive rather than collapsing to nothing.
    placeholderData: keepPreviousData,
  });
}
