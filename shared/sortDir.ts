/** Default sort direction when the caller omits `sortDir`. */
export function defaultSortDir(sort?: string): "asc" | "desc" {
  return sort === "rating" || sort === "captured" || sort === "accessed"
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
