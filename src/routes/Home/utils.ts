import {
  joinSearchTokens,
  splitSearchTokens,
  tagSearchKey,
} from "@shared/tags";
import { isActivityMetric, type ActivityMetric } from "@shared/ipc/activity";
import { isTimelineAxis, type TimelineAxis } from "@shared/ipc/timeline";
import type { SearchQuery } from "@/ipc/types";

export const DISCOVER_FILTER_PARAM = "filter";
export const VIEW_KEY = "meguri.view";

export type ViewMode = "grid" | "list" | "graph" | "timeline";

export function isViewMode(v: string | null): v is ViewMode {
  return v === "grid" || v === "list" || v === "graph" || v === "timeline";
}

/**
 * Whether a view can be drawn by folder. The graph and the timeline have no
 * folder form; the stored option waits for the grid and the list.
 */
export function hasFolderForm(view: ViewMode): boolean {
  return view === "grid" || view === "list";
}

/** Whether the heatmap panel is shown, remembered apart from the view mode. */
export const HEATMAP_OPEN_KEY = "meguri.heatmap";

/** What the heatmap counts, remembered apart from the view mode. */
export const HEATMAP_METRIC_KEY = "meguri.heatmapMetric";

export function parseHeatmapMetric(raw: string | null): ActivityMetric {
  return isActivityMetric(raw) ? raw : "played";
}

/** The date the timeline is ordered by, remembered apart from the view mode. */
export const TIMELINE_AXIS_KEY = "meguri.timelineAxis";

export function parseTimelineAxis(raw: string | null): TimelineAxis {
  return isTimelineAxis(raw) ? raw : "captured";
}

/**
 * The query the timeline reads its list with: the filter, ordered by the axis
 * newest first. The filter's own sort is left out rather than overwritten —
 * it is what the other views go back to.
 */
export function timelineQuery(
  filter: SearchQuery,
  axis: TimelineAxis,
): SearchQuery {
  return { ...filter, sort: axis, sortDir: "desc" };
}

/**
 * Reads a stored view mode. The table view was folded into the list, so a
 * stored "table" lands on the list rather than falling back to the grid.
 */
export function parseViewMode(raw: string | null): ViewMode {
  if (raw === "table") return "list";
  return isViewMode(raw) ? raw : "grid";
}

/** The "show by folder" option, remembered apart from the view mode. */
export const BY_FOLDER_KEY = "meguri.byFolder";

/**
 * Whether the file view is drawn by folder. The option applies to the grid and
 * the list alike, but folders exist only inside one real workspace: over "All"
 * or a collection the view is drawn flat, without touching the stored option,
 * which takes over again on returning to a workspace.
 */
export function isFolderView({
  byFolder,
  folderAvailable,
  view,
}: {
  byFolder: boolean;
  folderAvailable: boolean;
  /** Some views have no folder form (see hasFolderForm). */
  view?: ViewMode;
}): boolean {
  return byFolder && folderAvailable && (!view || hasFolderForm(view));
}

export function cleanDiscoverFilter(filter: SearchQuery): SearchQuery {
  const rest = { ...filter };
  delete rest.cursor;
  delete rest.limit;
  delete rest.sort;
  delete rest.sortDir;
  return Object.fromEntries(
    Object.entries(rest).filter(([, value]) => {
      if (value == null || value === false || value === "") return false;
      return !Array.isArray(value) || value.length > 0;
    }),
  );
}

export function discoverPath(filter: SearchQuery): string {
  const clean = cleanDiscoverFilter(filter);
  if (Object.keys(clean).length === 0) return "/discover";
  return `/discover?${DISCOVER_FILTER_PARAM}=${encodeURIComponent(JSON.stringify(clean))}`;
}

/**
 * AND-append search-box tokens (`tag:beach`, `tag:4k`) to the query, skipping
 * ones already present. Writing into `q` rather than `SearchQuery.tags[]` is what
 * puts the condition in the text field where the user can see and edit it; the
 * tokens still resolve to an exact tag match, so no file-name false positives
 * come back.
 *
 * Returns the same object reference when nothing changes, so the files_search
 * query key stays identical and the cached page (and scroll position) survives a
 * click on a tag that is already active.
 */
export function addSearchTokens(
  filter: SearchQuery,
  tokens: string[],
): SearchQuery {
  const current = splitSearchTokens(filter.q ?? "");
  // Incoming tokens arrive quoted where the value needs it (`tag:"beach house"`),
  // while `current` holds them unquoted — normalize both sides before comparing,
  // or a second click on a multi-word tag would append a duplicate.
  const incoming = tokens.flatMap((token) => splitSearchTokens(token));
  // A directive is compared on tagSearchKey rather than on the token, so a tag
  // clicked while `tag:4K` is already in the box is recognised as the condition
  // it resolves to — the same key the search box applies to a typed one. Free
  // text has no such resolution and stays an exact comparison.
  const keys = new Set(current.map(tagSearchKey));
  const added = incoming.filter((token) => {
    if (!token) return false;
    const key = tagSearchKey(token);
    if (key === null) return !current.includes(token);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  if (added.length === 0) return filter;
  return { ...filter, q: joinSearchTokens([...current, ...added]) };
}

/**
 * DOM id of Home's `<main>`, the box the list lives in. Read from outside
 * Home's tree by id: the page-scroll keys below, and the pet, whose floor is
 * this box's bottom edge.
 */
export const LIST_MAIN_ID = "list-main";

/** Scroll the list's scroll viewport by ~one screen (dir: 1 = down, -1 = up). */
export function scrollListByPage(dir: number) {
  const vp = document.querySelector<HTMLElement>(
    `#${LIST_MAIN_ID} [data-slot="scroll-area-viewport"]`,
  );
  if (!vp) return;
  vp.scrollBy({ top: dir * vp.clientHeight * 0.9, behavior: "smooth" });
}
