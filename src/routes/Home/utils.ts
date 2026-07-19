import type { SearchQuery } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";

export const SORT_KEYS: Record<string, TranslationKey> = {
  added: "sort.added",
  name: "sort.name",
  rating: "sort.rating",
  captured: "sort.captured",
  btime: "filter.btime",
  accessed: "sort.accessed",
  hash: "sort.hash",
};
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

export function sortLabel(t: TFunc, s: string): string {
  const key = SORT_KEYS[s];
  return t("filter.sortLabel", { label: key ? t(key) : s });
}

/** Scroll the list's scroll viewport by ~one screen (dir: 1 = down, -1 = up). */
export function scrollListByPage(dir: number) {
  const vp = document.querySelector<HTMLElement>(
    '#list-main [data-slot="scroll-area-viewport"]',
  );
  if (!vp) return;
  vp.scrollBy({ top: dir * vp.clientHeight * 0.9, behavior: "smooth" });
}
