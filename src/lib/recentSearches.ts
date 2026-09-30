// The last few searches run from the list, offered again by the command menu.
//
// A ring buffer of distinct queries, newest first. Queries go through
// cleanSearchQuery() on the way in, so two searches that differ only in empty
// fields or key order are one entry, and a query read back from storage is in
// the same shape as one just recorded.
//
// The folder is left out: where the list is browsing is not part of what was
// searched for, and a recent search reapplied elsewhere searches there.
import { SearchQuerySchema, type SearchQuery } from "@shared/ipc/schema";
import { cleanSearchQuery, hasFilterConditions } from "@/lib/smartCollections";

export const RECENT_SEARCHES_KEY = "meguri.recentSearches.v1";
/** How many distinct searches are kept. */
export const RECENT_SEARCHES_MAX = 10;

/** The query as it is kept: cleaned, without the folder. */
function normalize(query: SearchQuery): SearchQuery {
  const cleaned = cleanSearchQuery(query);
  delete cleaned.folder;
  return cleaned;
}

/** Identity for dedupe. cleanSearchQuery builds its keys in a fixed order. */
export function recentSearchKey(query: SearchQuery): string {
  return JSON.stringify(normalize(query));
}

/**
 * Put `query` at the front, dropping an earlier copy of it and whatever falls
 * past `max`. A query that narrows nothing (empty, or only a sort) is not a
 * search worth offering again: the list comes back unchanged.
 */
export function pushRecentSearch(
  list: SearchQuery[],
  query: SearchQuery,
  max = RECENT_SEARCHES_MAX,
): SearchQuery[] {
  const entry = normalize(query);
  if (!hasFilterConditions(entry)) return list;
  const key = JSON.stringify(entry);
  if (list.length > 0 && recentSearchKey(list[0]) === key) return list;
  return [entry, ...list.filter((q) => recentSearchKey(q) !== key)].slice(
    0,
    max,
  );
}

/**
 * The conditions to apply when a recent search is picked. It replaces the
 * current ones, except that a search recorded without a sort keeps the sort
 * in use: what a recent search recalls is what it narrowed to, and a sort
 * picked since is the user's current choice, not part of an older search.
 */
export function recallRecentSearch(
  query: SearchQuery,
  current: SearchQuery,
): SearchQuery {
  if (query.sort != null || current.sort == null) return query;
  const next: SearchQuery = { ...query, sort: current.sort };
  if (current.sortDir != null) next.sortDir = current.sortDir;
  return next;
}

export function parseRecentSearches(raw: string | null): SearchQuery[] {
  if (!raw) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return [];
    // Checked one by one, so an entry that no longer fits the schema costs
    // only itself rather than the whole history.
    const queries: SearchQuery[] = [];
    for (const item of stored) {
      const parsed = SearchQuerySchema.safeParse(item);
      if (parsed.success) queries.push(parsed.data);
    }
    // Re-pushed oldest first, so the stored list goes through the same
    // cleaning, dedupe and cap as a new entry would.
    return queries.reduceRight<SearchQuery[]>(
      (list, query) => pushRecentSearch(list, query),
      [],
    );
  } catch {
    return [];
  }
}
