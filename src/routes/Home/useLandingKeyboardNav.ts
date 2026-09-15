// Keyboard focus navigation over the landing shelves: a focused (shelf, item)
// pair moved with the same per-preset bindings as the list views
// (GRID_BINDINGS: arrows / hjkl / C-p,n,b,f). Left/right walk one shelf,
// up/down step between shelves, and down past the last shelf hands focus to
// the list below (`onExitBottom`); the list hands it back through `enterToken`.
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/settings/PreferencesProvider";
import { GRID_BINDINGS, matchAny } from "@/settings/keybindings";

export interface LandingFocus {
  shelf: number;
  index: number;
}

interface Options {
  /** Item count per shelf, in display order. Empty shelves are skipped. */
  shelfSizes: number[];
  /** Only handle keys while the shelves own keyboard focus. */
  active: boolean;
  /**
   * Bumped by the parent when focus enters from the list below; the last
   * shelf's first item takes focus.
   */
  enterToken: number;
  /** Down on the last shelf: the list takes over. */
  onExitBottom: () => void;
  onOpen: (focus: LandingFocus) => void;
  onInspect: (focus: LandingFocus) => void;
}

function nextShelf(sizes: number[], from: number, dir: 1 | -1): number {
  for (let s = from + dir; s >= 0 && s < sizes.length; s += dir)
    if (sizes[s] > 0) return s;
  return -1;
}

export function useLandingKeyboardNav({
  shelfSizes,
  active,
  enterToken,
  onExitBottom,
  onOpen,
  onInspect,
}: Options) {
  const { keybindingPreset } = usePreferences();
  const [focus, setFocus] = useState<LandingFocus | null>(null);

  // Read live values through a ref so the key listener never goes stale.
  const ref = useRef({
    shelfSizes,
    onExitBottom,
    onOpen,
    onInspect,
    preset: keybindingPreset,
    focus,
  });
  useEffect(() => {
    ref.current = {
      shelfSizes,
      onExitBottom,
      onOpen,
      onInspect,
      preset: keybindingPreset,
      focus,
    };
  });

  // Entering from the list lands on the last non-empty shelf's first item.
  // Only a change counts: the shelves remount with the last token (a view
  // switch, a filter cleared) and must not light up a focus ring on their own.
  const seenToken = useRef(enterToken);
  useEffect(() => {
    if (enterToken === seenToken.current) return;
    seenToken.current = enterToken;
    const sizes = ref.current.shelfSizes;
    const shelf = nextShelf(sizes, sizes.length, -1);
    // Driven by the parent's token, not by user-advanced state, so setting
    // state here is the intended handshake.
    setFocus(shelf >= 0 ? { shelf, index: 0 } : null);
  }, [enterToken]);

  // Keep focus on an item when its shelf shrinks: clamp to the last one, or
  // move to a neighbouring shelf when this one emptied (below first, as the
  // list is that way; above otherwise). Nothing left: no focus.
  useEffect(() => {
    if (!focus) return;
    const size = shelfSizes[focus.shelf] ?? 0;
    if (focus.index < size) return;
    let next: LandingFocus | null = null;
    if (size > 0) next = { shelf: focus.shelf, index: size - 1 };
    else {
      const s =
        nextShelf(shelfSizes, focus.shelf, 1) >= 0
          ? nextShelf(shelfSizes, focus.shelf, 1)
          : nextShelf(shelfSizes, focus.shelf, -1);
      if (s >= 0)
        next = { shelf: s, index: Math.min(shelfSizes[s] - 1, focus.index) };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocus(next);
  }, [shelfSizes, focus]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      const { shelfSizes, onExitBottom, onOpen, onInspect, preset, focus } =
        ref.current;
      const b = GRID_BINDINGS[preset];
      const first = nextShelf(shelfSizes, -1, 1);
      if (first < 0) return;

      if (matchAny(e, b.inspect)) {
        if (focus) {
          e.preventDefault();
          onInspect(focus);
        }
        return;
      }
      if (matchAny(e, b.open)) {
        if (focus) {
          e.preventDefault();
          onOpen(focus);
        }
        return;
      }

      // With nothing focused yet, any move lands on the first item.
      if (!focus) {
        if (
          !matchAny(e, b.right) &&
          !matchAny(e, b.left) &&
          !matchAny(e, b.down) &&
          !matchAny(e, b.up)
        )
          return;
        e.preventDefault();
        setFocus({ shelf: first, index: 0 });
        return;
      }
      const cur = focus;
      let next: LandingFocus | null;
      if (matchAny(e, b.right)) {
        next = {
          shelf: cur.shelf,
          index: Math.min(shelfSizes[cur.shelf] - 1, cur.index + 1),
        };
      } else if (matchAny(e, b.left)) {
        next = { shelf: cur.shelf, index: Math.max(0, cur.index - 1) };
      } else if (matchAny(e, b.down)) {
        const s = nextShelf(shelfSizes, cur.shelf, 1);
        if (s < 0) {
          e.preventDefault();
          setFocus(null);
          onExitBottom();
          return;
        }
        next = { shelf: s, index: Math.min(shelfSizes[s] - 1, cur.index) };
      } else if (matchAny(e, b.up)) {
        const s = nextShelf(shelfSizes, cur.shelf, -1);
        // Already on the top shelf: stay put (nothing above the shelves).
        if (s < 0) {
          e.preventDefault();
          return;
        }
        next = { shelf: s, index: Math.min(shelfSizes[s] - 1, cur.index) };
      } else return;

      e.preventDefault();
      if (next) setFocus(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return { focus, setFocus } as const;
}
