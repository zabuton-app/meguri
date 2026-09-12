// Live OS-level "prefers-reduced-motion: reduce" preference. Components skip
// rendering decorative effect DOM entirely when this is true (the CSS
// `@media (prefers-reduced-motion: reduce)` block in styles.css is only a
// backup layer for call sites that forget).
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function canQuery(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(onChange: () => void): () => void {
  if (!canQuery()) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return canQuery() && window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
