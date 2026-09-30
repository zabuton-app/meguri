// Recent searches (see src/lib/recentSearches.ts), shared between the list
// that records them and the command menu that offers them. Held outside React
// like useListCounts, so a search recorded while the menu is open shows up in
// it, and each reader re-renders only when the list actually changes.
import { useSyncExternalStore } from "react";
import type { SearchQuery } from "@/ipc/types";
import {
  parseRecentSearches,
  pushRecentSearch,
  RECENT_SEARCHES_KEY,
} from "@/lib/recentSearches";

// Read from storage on first use rather than at import, so a test that
// seeds localStorage before rendering sees its seed.
let value: SearchQuery[] | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRecentSearches(): SearchQuery[] {
  if (value === null) {
    try {
      value = parseRecentSearches(localStorage.getItem(RECENT_SEARCHES_KEY));
    } catch {
      value = [];
    }
  }
  return value;
}

function set(next: SearchQuery[]): void {
  if (next === value) return;
  value = next;
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the in-memory list still works.
  }
  listeners.forEach((l) => l());
}

/** Record a search (ignored when it narrows nothing). */
export function recordRecentSearch(query: SearchQuery): void {
  set(pushRecentSearch(getRecentSearches(), query));
}

export function clearRecentSearches(): void {
  if (getRecentSearches().length === 0) return;
  set([]);
}

/** Forget the in-memory copy so the next read goes back to storage (tests). */
export function resetRecentSearchesForTest(): void {
  value = null;
}

export function useRecentSearches(): SearchQuery[] {
  return useSyncExternalStore(subscribe, getRecentSearches);
}
