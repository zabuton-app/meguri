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

export function detailPath(
  id: number,
  wsId: string,
  filterParam?: string,
  sec?: number,
  opts: { autoplay?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (sec != null) params.set("t", String(sec));
  // Same opt-out the list views use for the "inspect" gesture (`?autoplay=0`).
  if (opts.autoplay === false) params.set("autoplay", "0");
  params.set("from", "discover");
  params.set("ws", wsId);
  if (filterParam) params.set("filter", filterParam);
  return `/file/${id}?${params.toString()}`;
}
