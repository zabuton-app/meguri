/**
 * The collection's own item order. A protocol value both processes must agree
 * on — the renderer offers it as a sort, the main process routes on it — so it
 * lives here rather than being spelled out on each side.
 */
export const MANUAL_SORT = "manual";

/** Default sort direction when the caller omits `sortDir`. */
export function defaultSortDir(sort?: string): "asc" | "desc" {
  return sort === "rating" ||
    sort === "captured" ||
    sort === "btime" ||
    sort === "accessed"
    ? "desc"
    : "asc";
}

/** Resolve an explicit sort direction or fall back to {@link defaultSortDir}. */
export function resolveSortDir(
  sort?: string,
  dir?: string,
): "asc" | "desc" {
  return dir === "asc" || dir === "desc" ? dir : defaultSortDir(sort);
}
