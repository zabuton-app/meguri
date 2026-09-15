// Data for the Home view's shelves. Small queries of their own (a handful of
// rows each, across every workspace), only while the view is active.
//
// Both are refreshed only by explicit invalidation (a scan, the tag catalog
// changing, a workspace removed) rather than by staleness or window focus:
// the shelves are entry points, not a live view, and the picks in particular
// are meant to hold still for the day. The keys are owned by lib/queryCache
// so the favorite / rating / removal patches reach the shelf rows.
//
// A third shelf ("Continue watching", #122) is one more `ShelfData` here and
// one more entry in HomeShelves' shelf list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { HOME_PICKS_KEY, HOME_RECENT_KEY } from "@/lib/queryCache";
import {
  PICKS_LIMIT,
  RECENT_LIMIT,
  RECENT_SORT,
  msUntilNextDay,
  picksDayKey,
} from "./shelves";

/** One shelf's rows and where its query stands. */
export interface ShelfData {
  /** The rows to show. Kept from the last success when a later attempt fails. */
  files: FileRow[];
  /** The query has answered at least once (rows or an error). */
  loaded: boolean;
  /** The last attempt failed. With `files` empty that is "could not load"; with
   *  rows it is a failed refresh, and the rows stay usable. */
  error: boolean;
  fetching: boolean;
}

export interface HomeShelvesData {
  recent: ShelfData;
  picks: ShelfData;
  /** Draw a fresh sample of picks for today. Stable. */
  reshufflePicks: () => void;
  /** Refresh after a scan: the newest files may have changed. Stable. */
  refreshAfterScan: () => void;
}

// One shared empty array, so a shelf with nothing keeps a stable identity
// across renders (the view is memoized on its props).
const NO_FILES: FileRow[] = [];

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
): HomeShelvesData {
  const qc = useQueryClient();
  const day = useDayKey();
  const wsId = workspaceId ?? null;

  const recent = useQuery({
    queryKey: [HOME_RECENT_KEY, wsId],
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (await api.filesSearch({ ...RECENT_SORT, limit: RECENT_LIMIT })).items,
  });

  // Stable for the day: the sample is only redrawn by the day changing, an
  // explicit reshuffle, or the library having been empty when a scan lands.
  // Kept in the cache for as long as the app runs (the sample is a full pass
  // over every workspace), so leaving Home and coming back does not redraw.
  const picks = useQuery({
    queryKey: [HOME_PICKS_KEY, wsId, day],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => api.filesRandom({ limit: PICKS_LIMIT }),
  });

  // Callbacks stay referentially stable (they feed the memoized view and a
  // long-lived event subscription); the values they read live in a ref.
  const refetchPicks = picks.refetch;
  const reshufflePicks = useCallback(() => {
    void refetchPicks();
  }, [refetchPicks]);

  const picksEmpty = (picks.data?.length ?? 0) === 0;
  const picksEmptyRef = useRef(picksEmpty);
  useEffect(() => {
    picksEmptyRef.current = picksEmpty;
  }, [picksEmpty]);
  const refreshAfterScan = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [HOME_RECENT_KEY, wsId] });
    // A scan does not reshuffle a sample the user already has today; it only
    // fills an empty shelf (the workspace had nothing to pick from before).
    if (picksEmptyRef.current)
      void qc.invalidateQueries({ queryKey: [HOME_PICKS_KEY, wsId] });
  }, [qc, wsId]);

  // Stable per shelf, so the memoized view only re-renders on a real change.
  const recentData = useMemo<ShelfData>(
    () => ({
      files: recent.data ?? NO_FILES,
      loaded: recent.isFetched,
      error: recent.isError,
      fetching: recent.isFetching,
    }),
    [recent.data, recent.isFetched, recent.isError, recent.isFetching],
  );
  const picksData = useMemo<ShelfData>(
    () => ({
      files: picks.data ?? NO_FILES,
      loaded: picks.isFetched,
      error: picks.isError,
      fetching: picks.isFetching,
    }),
    [picks.data, picks.isFetched, picks.isError, picks.isFetching],
  );

  return {
    recent: recentData,
    picks: picksData,
    reshufflePicks,
    refreshAfterScan,
  };
}
