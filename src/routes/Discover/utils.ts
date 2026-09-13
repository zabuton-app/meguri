import type { SearchQuery } from "@/ipc/types";

export const QUEUE_SIZE = 20;
export const DISCOVER_FILTER_PARAM = "filter";

export function parseDiscoverFilter(raw: string | null): SearchQuery {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SearchQuery;
    const filter = { ...parsed };
    delete filter.cursor;
    delete filter.limit;
    delete filter.sort;
    delete filter.sortDir;
    return filter;
  } catch {
    return {};
  }
}
