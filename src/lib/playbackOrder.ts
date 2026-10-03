// Which order the detail view's prev/next walks, as its URL says it.
//
// Detoured to from the player (`from=player`), the detail view walks what the
// player was playing rather than the list. Stepping to another file drops
// `from=player` — the player's parked pass belongs to the file it was left on
// (see usePrevNextNavigation) — so the order is carried on by a marker of its
// own; without one the walk would fall back to the list after one step, which
// browsing by folder holds only the folder's direct files.
const ORDER_PARAM = "order";
const PLAYBACK_ORDER = "playback";

/** Whether a detail view at these params walks the player's order. */
export function walksPlaybackOrder(params: URLSearchParams): boolean {
  return (
    params.get("from") === "player" ||
    params.get(ORDER_PARAM) === PLAYBACK_ORDER
  );
}

/** Mark `params` (of a detail view being navigated to) as walking that order. */
export function keepPlaybackOrder(params: URLSearchParams): void {
  params.set(ORDER_PARAM, PLAYBACK_ORDER);
}
