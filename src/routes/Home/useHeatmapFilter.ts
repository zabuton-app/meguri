// The heatmap's side of the filter.
//
// The heatmap is a panel over the list, in any view: whether it is shown and
// what a day counts (the metric) are remembered here. The days picked are not
// kept anywhere of their own: they are the filter's date range for that metric
// (see heatmap/pickedDays.ts), so picking is an edit of the filter like any
// control of the bar makes.
import { useCallback } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { withPickedDays, type DayRange } from "@/heatmap/pickedDays";
import type { SearchQuery } from "@/ipc/types";
import type { ActivityMetric } from "@shared/ipc/activity";
import {
  HEATMAP_METRIC_KEY,
  HEATMAP_OPEN_KEY,
  parseHeatmapMetric,
} from "./utils";

export function useHeatmapFilter({
  filterValue,
  onFilterChange,
}: {
  /** The filter as the bar holds it, and the bar's way of changing it. */
  filterValue: SearchQuery;
  onFilterChange: (next: SearchQuery) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>(
    HEATMAP_OPEN_KEY,
    false,
    (raw) => raw === "true",
  );
  const toggle = useCallback(() => setOpen((on) => !on), [setOpen]);
  // Changing the metric leaves the filter alone: a range already set stays a
  // condition of the list, named by its chip, and narrows the new counts.
  const [metric, setMetric] = useLocalStorage<ActivityMetric>(
    HEATMAP_METRIC_KEY,
    "played",
    parseHeatmapMetric,
  );

  /** The days become the date range of the metric shown; null removes it. */
  const pickRange = useCallback(
    (range: DayRange | null) =>
      onFilterChange(withPickedDays(filterValue, metric, range)),
    [onFilterChange, filterValue, metric],
  );

  return { open, toggle, metric, setMetric, pickRange };
}
