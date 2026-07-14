import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * useState backed by localStorage. The stored value is restored on mount and
 * persisted on every set. `parse` validates and coerces the raw string read
 * from storage (return the fallback value when invalid).
 *
 * The setter accepts the same shape as React's setState (next value OR
 * `(prev) => next`). The setter reference is stable for a given `key`, so it
 * can be passed to memoized children without invalidating their memo.
 *
 * Restricted to primitive types because values are persisted via `String(v)`.
 * For objects or arrays, JSON-encode them in a dedicated hook.
 */
export function useLocalStorage<T extends string | number | boolean | null>(
  key: string,
  initial: T,
  parse: (raw: string | null) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return initial;
    }
  });
  const set: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      setValue((prev) => {
        const v = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(key, String(v));
        } catch {
          /* storage may be full or disabled; tolerate silently */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}
