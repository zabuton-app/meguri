// The heatmap's counts for a scope, query and range of days.
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import type { ActivityMetric } from "@shared/ipc/activity";
import { withoutPickedDays } from "./pickedDays";

/**
 * Parts of a query the counts ignore; dropped so they do not refetch them.
 * Among them the metric's own date range, which is the day picked on the
 * heatmap (the main process leaves it out as well).
 */
function activityQuery(
  query: SearchQuery,
  metric: ActivityMetric,
): SearchQuery {
  const q = { ...withoutPickedDays(query, metric) };
  delete q.cursor;
  delete q.limit;
  delete q.folder;
  delete q.sort;
  delete q.sortDir;
  return q;
}

export function useActivityDays({
  scope,
  query,
  metric,
  from,
  to,
  enabled,
}: {
  scope: string;
  query: SearchQuery;
  metric: ActivityMetric;
  /** First and last day, "YYYY-MM-DD", both included. */
  from: string;
  to: string;
  enabled: boolean;
}) {
  const q = activityQuery(query, metric);
  const result = useQuery({
    // Scope and filter sit where files_search keeps them, so the cache
    // helpers in queryCache.ts read both keys the same way.
    queryKey: ["activity_days", scope, q, metric, from, to],
    queryFn: () => api.activityDays({ query: q, metric, from, to }),
    enabled,
    // Paging through years or typing a search keeps the old cells on screen
    // rather than blanking the graph until the new counts arrive.
    placeholderData: keepPreviousData,
  });
  const counts = useMemo(
    () => new Map(result.data?.days.map((d) => [d.date, d.count]) ?? []),
    [result.data],
  );
  return {
    counts,
    isLoading: result.isLoading,
    isError: result.isError,
    /** The cells on screen belong to an earlier request. */
    isStale: result.isPlaceholderData,
  };
}
