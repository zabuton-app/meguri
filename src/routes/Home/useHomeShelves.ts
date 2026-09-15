// Data for the home landing shelves. Two small queries of their own, so the
// main list is never delayed by them: they only start once the list's first
// page is in (`enabled`), and each asks for a handful of rows.
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import {
  PICKS_LIMIT,
  RECENT_LIMIT,
  RECENT_SORT,
  msUntilNextDay,
  picksDayKey,
} from "./landing";

/** Query key prefix of the Recently added shelf (owned by lib/queryCache, which patches it). */
import { HOME_RECENT_KEY } from "@/lib/queryCache";
export { HOME_RECENT_KEY };
/**
 * The picks query lives under the discovery queue's prefix so the favorite /
 * rating / removal patches in lib/queryCache reach it without knowing about
 * the shelf; the second segment keeps it apart from Discovery's own queue.
 */
export const HOME_PICKS_KEY = ["files_random", "home_picks"] as const;

export interface HomeShelves {
  recent: FileRow[];
  picks: FileRow[];
  /** True once both shelves have answered at least once. */
  loaded: boolean;
  picksFetching: boolean;
  /** Draw a fresh sample of picks for today. */
  reshufflePicks: () => void;
  /** Refresh after a scan: the newest files may have changed. */
  refreshAfterScan: () => void;
}

/** Tracks the local calendar day, ticking over at midnight while the app stays open. */
function useDayKey(): string {
  const [day, setDay] = useState(() => picksDayKey());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setDay(picksDayKey());
        arm();
      }, msUntilNextDay());
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  return day;
}

export function useHomeShelves(
  workspaceId: string | null | undefined,
  enabled: boolean,
): HomeShelves {
  const qc = useQueryClient();
  const day = useDayKey();
  const wsId = workspaceId ?? null;

  const recent = useQuery({
    queryKey: [HOME_RECENT_KEY, wsId],
    enabled,
    queryFn: async () =>
      (await api.filesSearch({ ...RECENT_SORT, limit: RECENT_LIMIT })).items,
  });

  // Stable for the day: the sample is only redrawn by the day changing, an
  // explicit reshuffle, or the library having been empty when a scan lands.
  const picks = useQuery({
    queryKey: [...HOME_PICKS_KEY, wsId, day],
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => api.filesRandom({ limit: PICKS_LIMIT }),
  });

  const reshufflePicks = useCallback(() => {
    void picks.refetch();
  }, [picks]);

  const picksEmpty = (picks.data?.length ?? 0) === 0;
  const refreshAfterScan = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [HOME_RECENT_KEY, wsId] });
    // A scan does not reshuffle a sample the user already has today; it only
    // fills an empty shelf (the workspace had nothing to pick from before).
    if (picksEmpty)
      void qc.invalidateQueries({ queryKey: [...HOME_PICKS_KEY, wsId] });
  }, [qc, wsId, picksEmpty]);

  return {
    recent: recent.data ?? [],
    picks: picks.data ?? [],
    loaded: recent.isFetched && picks.isFetched,
    picksFetching: picks.isFetching,
    reshufflePicks,
    refreshAfterScan,
  };
}
