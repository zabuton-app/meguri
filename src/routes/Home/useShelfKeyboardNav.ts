// Keyboard focus navigation over the Home view's shelves: a focused (shelf,
// item) pair moved with the same per-preset bindings as the list views
// (GRID_BINDINGS: arrows / hjkl / C-p,n,b,f). Left/right walk one shelf,
// up/down step between shelves; Enter opens, Shift+Enter inspects.
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/settings/PreferencesProvider";
import { GRID_BINDINGS, matchAny } from "@/settings/keybindings";

export interface ShelfFocus {
  shelf: number;
  index: number;
}

interface Options {
  /** Item count per shelf, in display order. Empty shelves are skipped. */
  shelfSizes: number[];
  /** Only handle keys while the Home view is foreground (no modal on top). */
  active: boolean;
  onOpen: (focus: ShelfFocus) => void;
  onInspect: (focus: ShelfFocus) => void;
}

function nextShelf(sizes: number[], from: number, dir: 1 | -1): number {
  for (let s = from + dir; s >= 0 && s < sizes.length; s += dir)
    if (sizes[s] > 0) return s;
  return -1;
}

export function useShelfKeyboardNav({
  shelfSizes,
  active,
  onOpen,
  onInspect,
}: Options) {
  const { keybindingPreset } = usePreferences();
  const [focus, setFocus] = useState<ShelfFocus | null>(null);

  // Read live values through a ref so the key listener never goes stale.
  const ref = useRef({
    shelfSizes,
    onOpen,
    onInspect,
    preset: keybindingPreset,
    focus,
  });
  useEffect(() => {
    ref.current = {
      shelfSizes,
      onOpen,
      onInspect,
      preset: keybindingPreset,
      focus,
    };
  });

  // Keep focus on an item when its shelf shrinks: clamp to the last one, or
  // move to a neighbouring shelf when this one emptied (the one below first,
  // then above). Nothing left: no focus.
  useEffect(() => {
    if (!focus) return;
    const size = shelfSizes[focus.shelf] ?? 0;
    if (focus.index < size) return;
    let next: ShelfFocus | null = null;
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
      // A real control has the keyboard (a Tab-focused button or link on the
      // hero): Enter is its own, and the arrows are left to it as well.
      if (el?.closest("button, a, [role='button'], [role='separator']")) return;
      const { shelfSizes, onOpen, onInspect, preset, focus } = ref.current;
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
      let next: ShelfFocus | null;
      if (matchAny(e, b.right)) {
        next = {
          shelf: cur.shelf,
          index: Math.min(shelfSizes[cur.shelf] - 1, cur.index + 1),
        };
      } else if (matchAny(e, b.left)) {
        next = { shelf: cur.shelf, index: Math.max(0, cur.index - 1) };
      } else if (matchAny(e, b.down) || matchAny(e, b.up)) {
        const s = nextShelf(
          shelfSizes,
          cur.shelf,
          matchAny(e, b.down) ? 1 : -1,
        );
        // Already on the first / last shelf: stay put.
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

  return { focus } as const;
}
