import type { SceneBookmark } from "@/ipc/types";

// Two bookmarks within this many seconds are treated as the same instant: the player's
// toggle button switches to "remove" mode when the current position is inside this window.
// Mirrors BOOKMARK_NEAR_EPS in electron/core/queries.ts (server-side dedupe) — keep in sync.
export const BOOKMARK_NEAR_EPS = 2;

export function findNearestBookmark(
  bookmarks: SceneBookmark[] | undefined,
  sec: number,
): SceneBookmark | null {
  if (!bookmarks?.length) return null;
  let best: SceneBookmark | null = null;
  let bestDist = Infinity;
  for (const b of bookmarks) {
    const d = Math.abs(b.sec - sec);
    if (d <= BOOKMARK_NEAR_EPS && d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
