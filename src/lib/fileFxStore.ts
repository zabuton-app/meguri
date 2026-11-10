// Favorite and rating effects asked for from outside a file's own controls:
// the file context menu and the command menu, which change files whose cards
// play nothing of their own (#303).
//
// FavoriteButton and RatingStars start their effect from their own click. A
// change made elsewhere reaches them only as a new value, which must not play
// anything (a cache sync from another view is not the user acting on this
// card), so whoever makes the change says so here, and the controls of those
// files read it.
//
// An entry lives only while its effect plays, then goes: a control mounted
// meanwhile (the heart a favorite mounts on a card that is not hovered) still
// plays it, one mounted later finds nothing, and a card keeps a control on
// screen while it is here (useFavoriteFxLive, useRatingFxLive). The controls
// keep the last effect they played themselves, so they never replay or fall
// back to an older one when an entry goes, nor carry one over to another file
// when they are reused for it.
//
// Listeners are kept per file, as in thumbVersionStore: an effect notifies
// only the controls of the files it names.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { mediaSortId } from "@/lib/mediaSortId";

export interface FileKey {
  id: number;
  workspaceId: string;
}

export interface FavoriteFx {
  seq: number;
  variant: "add" | "remove";
}

export interface RatingFx {
  seq: number;
  variant: "set" | "clear";
  /** The stars that play: up to the new rating, or the old one when clearing. */
  upTo: number;
}

/**
 * Long enough for a pop and its burst (`.fx-pop` and `.fx-particle`, 450ms
 * in styles.css), and for the heart a favorite mounts once the write lands.
 */
const LIVE_MS = 1000;
/** A removed heart or cleared stars are kept for `.fx-settle` (250ms) only. */
const SETTLE_LIVE_MS = 400;

let seq = 0;

type Entries<T> = Map<string, T>;
const favorites: Entries<FavoriteFx> = new Map();
const ratings: Entries<RatingFx> = new Map();
const listeners = new Map<string, Set<() => void>>();
/**
 * Effects a control has played. A card swaps its drawn stars for the editable
 * ones on hover, and back: the one mounted second must not play it again.
 */
const claimed = new Set<number>();

function notify(keys: Iterable<string>) {
  for (const key of keys) {
    for (const listener of listeners.get(key) ?? []) listener();
  }
}

function subscribeKey(key: string, listener: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

function put<T extends { seq: number }>(
  map: Entries<T>,
  entries: [string, T][],
  liveMs: number,
) {
  if (entries.length === 0) return;
  for (const [key, fx] of entries) map.set(key, fx);
  notify(entries.map(([key]) => key));
  window.setTimeout(() => {
    // One asked for since has its own timer.
    const over = entries.filter(([key, fx]) => map.get(key) === fx);
    for (const [key, fx] of over) {
      map.delete(key);
      claimed.delete(fx.seq);
    }
    notify(over.map(([key]) => key));
  }, liveMs);
}

/** Play a favorite toggle on the files it changes. */
export function playFavoriteFx(
  files: (FileKey & { favorite: number | boolean })[],
  favorite: boolean,
): void {
  const variant = favorite ? "add" : "remove";
  put(
    favorites,
    files
      .filter((f) => !!f.favorite !== favorite)
      .map((f) => [mediaSortId(f), { seq: ++seq, variant }]),
    favorite ? LIVE_MS : SETTLE_LIVE_MS,
  );
}

/** Play a new rating on the files it changes. */
export function playRatingFx(
  files: (FileKey & { rating: number })[],
  rating: number,
): void {
  put(
    ratings,
    files
      .filter((f) => f.rating !== rating)
      .map((f): [string, RatingFx] => [
        mediaSortId(f),
        rating === 0
          ? { seq: ++seq, variant: "clear", upTo: f.rating }
          : { seq: ++seq, variant: "set", upTo: rating },
      ]),
    rating === 0 ? SETTLE_LIVE_MS : LIVE_MS,
  );
}

function useEntry<T>(
  map: Entries<T>,
  file: FileKey | undefined,
): T | undefined {
  const key = file ? mediaSortId(file) : null;
  const subscribe = useCallback(
    (listener: () => void) => (key ? subscribeKey(key, listener) : () => {}),
    [key],
  );
  return useSyncExternalStore(subscribe, () =>
    key ? map.get(key) : undefined,
  );
}

/**
 * A control's effect: the later of its own (`play`, from its click) and one
 * asked for here for its file. `fx.seq` is 0 until one has played.
 */
function useControlFx<T extends { seq: number }>(
  map: Entries<T>,
  file: FileKey | undefined,
  none: T,
): [T, (fx: Omit<T, "seq">) => void] {
  const key = file ? mediaSortId(file) : null;
  const outside = useEntry(map, file);
  const [played, setPlayed] = useState<{ key: string | null; fx: T }>({
    key,
    fx: none,
  });
  // Derived from the store during render (React's "adjusting state when a
  // prop changes"): a control reused for another file starts over, and one
  // asked for here is kept once it has played.
  let fx = played.key === key ? played.fx : none;
  if (outside && outside.seq > fx.seq && !claimed.has(outside.seq)) {
    fx = outside;
  }
  if (played.key !== key || played.fx !== fx) setPlayed({ key, fx });
  useClaim(fx === outside ? outside : undefined);

  const play = useCallback(
    (own: Omit<T, "seq">) =>
      setPlayed({ key, fx: { ...own, seq: ++seq } as T }),
    [key],
  );
  return [fx, play];
}

/** Mark an effect from here as played, once this control has drawn it. */
function useClaim(fx: { seq: number } | undefined) {
  useEffect(() => {
    if (fx) claimed.add(fx.seq);
  }, [fx]);
}

const NO_FAVORITE_FX: FavoriteFx = { seq: 0, variant: "add" };
const NO_RATING_FX: RatingFx = { seq: 0, variant: "set", upTo: 0 };

export const useFavoriteFx = (file: FileKey | undefined) =>
  useControlFx(favorites, file, NO_FAVORITE_FX);

export const useRatingFx = (file: FileKey | undefined) =>
  useControlFx(ratings, file, NO_RATING_FX);

/**
 * The rating effect playing on the file, for stars that are only drawn: they
 * have no effect of their own, and go back to plain stars once it is over.
 */
export function useDrawnRatingFx(
  file: FileKey | undefined,
): RatingFx | undefined {
  const entry = useEntry(ratings, file);
  // Played already by the editable stars this card swapped out.
  const [skip] = useState(() =>
    entry && claimed.has(entry.seq) ? entry.seq : 0,
  );
  const fx = entry && entry.seq !== skip ? entry : undefined;
  useClaim(fx);
  return fx;
}

/** Whether a favorite effect is playing on the file: keep its heart shown. */
export const useFavoriteFxLive = (file: FileKey): boolean =>
  useEntry(favorites, file) !== undefined;

/** Whether a rating effect is playing on the file: keep its stars shown. */
export const useRatingFxLive = (file: FileKey): boolean =>
  useEntry(ratings, file) !== undefined;

/** Forget every effect; tests only. */
export function resetFileFxForTest(): void {
  favorites.clear();
  ratings.clear();
  claimed.clear();
  seq = 0;
}
