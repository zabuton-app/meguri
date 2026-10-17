// Where the auto-tagging screen was left: which tab, what was selected, how
// each list was filtered. Kept at module level, outside the component tree,
// because the screen is a routed modal — opening a file from it, or just
// closing it, unmounts everything — and coming back should land where one was.
//
// For the life of the window, not across restarts: this is a place in a
// working session, not a preference.
import { useCallback, useState } from "react";

const store = new Map<string, unknown>();

/**
 * `useState` that remembers its value under `key` after the component is gone.
 * The key names one piece of the screen ("suggest.filter"), so two components
 * must not share one.
 */
export function useViewState<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : initial,
  );
  const set = useCallback(
    (next: T) => {
      store.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

/** Forget everything. Tests start each case from a screen never opened. */
export function resetViewState(): void {
  store.clear();
}
