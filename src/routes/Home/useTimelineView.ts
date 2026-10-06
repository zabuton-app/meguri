// The timeline's side of the list: the date it runs along, and where in the
// list the window is read from.
//
// The axis is remembered here. The anchor is a cursor the list is read from
// when the view is away from the loaded window (a month picked on the rail,
// a drag of the scrollbar; see src/timeline/anchor.ts); it belongs to the list
// it was taken in, so another scope, filter or axis starts from the top again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { filesSearchKey } from "@/hooks/useFilesSearch";
import type { SearchQuery } from "@/ipc/types";
import { sameAnchor } from "@/timeline/anchor";
import type { FilesSearchPageParam } from "@/lib/filesSearch";
import type { TimelineAxis } from "@shared/ipc/timeline";
import {
  parseTimelineAxis,
  TIMELINE_AXIS_KEY,
  timelineQuery,
  type ViewMode,
} from "./utils";

export function useTimelineView({
  view,
  workspaceId,
  filter,
}: {
  view: ViewMode;
  workspaceId: string | null | undefined;
  /** The filter as the bar holds it; the timeline puts its own sort on it. */
  filter: SearchQuery;
}) {
  const qc = useQueryClient();
  const [axis, setAxis] = useLocalStorage<TimelineAxis>(
    TIMELINE_AXIS_KEY,
    "captured",
    parseTimelineAxis,
  );
  // The query the list is read with under the timeline: the filter ordered
  // by the axis, newest first (the filter's own sort is left for the other
  // views).
  const searchQuery = useMemo(
    () => timelineQuery(filter, axis),
    [filter, axis],
  );
  const scope = `${workspaceId ?? ""}|${JSON.stringify(searchQuery)}`;
  const [stored, setStored] = useState<{
    scope: string;
    param: FilesSearchPageParam;
  } | null>(null);
  const anchor =
    view === "timeline" && stored?.scope === scope ? stored.param : undefined;

  // A window opened at a cursor is a query of its own; once the list has
  // moved to another, it is dropped rather than kept for the cache's time
  // (the list at the top, with no cursor, is kept: it is the other views').
  const lastKey = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    const key = filesSearchKey(workspaceId, searchQuery, anchor);
    const prev = lastKey.current;
    lastKey.current = anchor === undefined ? null : key;
    if (prev && JSON.stringify(prev) !== JSON.stringify(key))
      qc.removeQueries({ queryKey: prev, exact: true });
  }, [qc, workspaceId, searchQuery, anchor]);

  const onAnchor = useCallback(
    (param: FilesSearchPageParam) => {
      // The view is away from the window the list has. A list cached under
      // the cursor asked for may have slid down the list before the view
      // left it (the window is a sliding one): with its data in hand, it is
      // read again from the cursor rather than shown where it stopped.
      // Without data it is being read already, and is left to arrive.
      const key = filesSearchKey(workspaceId, searchQuery, param);
      if (qc.getQueryData(key) !== undefined)
        void qc.resetQueries({ queryKey: key, exact: true });
      setStored((prev) =>
        prev?.scope === scope && sameAnchor(prev.param, param)
          ? prev
          : { scope, param },
      );
    },
    [qc, workspaceId, searchQuery, scope],
  );

  return { axis, setAxis, searchQuery, anchor, onAnchor };
}
