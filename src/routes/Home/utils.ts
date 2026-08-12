import {
  joinSearchTokens,
  splitSearchTokens,
  tagSearchKey,
} from "@shared/tags";
import type { SearchQuery } from "@/ipc/types";

export const DISCOVER_FILTER_PARAM = "filter";
export const VIEW_KEY = "meguri.view";

export type ViewMode = "grid" | "list" | "table";

export function isViewMode(v: string | null): v is ViewMode {
  return v === "grid" || v === "list" || v === "table";
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

/** Scroll the list's scroll viewport by ~one screen (dir: 1 = down, -1 = up). */
export function scrollListByPage(dir: number) {
  const vp = document.querySelector<HTMLElement>(
    '#list-main [data-slot="scroll-area-viewport"]',
  );
  if (!vp) return;
  vp.scrollBy({ top: dir * vp.clientHeight * 0.9, behavior: "smooth" });
}
