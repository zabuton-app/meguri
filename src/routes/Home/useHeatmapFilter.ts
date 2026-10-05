// The heatmap's side of the filter.
//
// What a day counts (the metric) is remembered here. The day picked is not
// kept anywhere of its own: it is the filter's date range for that metric
// (see heatmap/pickedDays.ts), so picking one is an edit of the filter like
// any control of the bar makes.
import { useCallback } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { pickedDays, singleDay, withPickedDay } from "@/heatmap/pickedDays";
import type { SearchQuery } from "@/ipc/types";
import type { ActivityMetric } from "@shared/ipc/activity";
import { HEATMAP_METRIC_KEY, parseHeatmapMetric } from "./utils";

export function useHeatmapFilter({
  filterValue,
  onFilterChange,
}: {
  /** The filter as the bar holds it, and the bar's way of changing it. */
  filterValue: SearchQuery;
  onFilterChange: (next: SearchQuery) => void;
}) {
  const [metric, setMetric] = useLocalStorage<ActivityMetric>(
    HEATMAP_METRIC_KEY,
    "played",
    parseHeatmapMetric,
  );

  /** The day becomes the date range of the metric shown; null removes it. */
  const pickDay = useCallback(
    (day: string | null) =>
      onFilterChange(withPickedDay(filterValue, metric, day)),
    [onFilterChange, filterValue, metric],
  );

  // Another metric dates the files another way: a day picked under the one
  // left goes with it, so the list is not narrowed by a day no cell shows.
  // Only a single day, the shape a pick has: a longer or open range was typed
  // in the panel, and a look at another metric is no reason to drop it.
  const changeMetric = useCallback(
    (next: ActivityMetric) => {
      if (next === metric) return;
      setMetric(next);
      if (singleDay(pickedDays(filterValue, metric)) !== null)
        onFilterChange(withPickedDay(filterValue, metric, null));
    },
    [metric, setMetric, filterValue, onFilterChange],
  );

  return { metric, changeMetric, pickDay };
}
