// Keyboard focus navigation for the list/grid/table views. Tracks a focused item
// index (state-driven ring rather than DOM focus, so it survives virtualization)
// and moves it per the active keybinding preset: arrows (normal), hjkl (vim), or
// C-p/n/b/f (emacs); Enter opens the focused item. The grid passes its column count
// so up/down step a full row; list/table pass columns=1 for plain vertical movement.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences } from "@/settings/PreferencesProvider";
import { GRID_BINDINGS, matchAny } from "@/settings/keybindings";

interface Options {
  /** Number of items currently loaded. */
  itemCount: number;
  /** Items per row (1 for list/table, the measured column count for the grid). */
  columns: number;
  /** Only handle keys while this view is foreground (no modal on top). */
  active: boolean;
  /** Open the item at the given index. */
  onOpen: (index: number) => void;
  /** Open the item's detail view without autoplay (Shift+Enter). */
  onInspect?: (index: number) => void;
  /** Scroll the virtual row into view (row = floor(index / columns)). */
  scrollToRow: (row: number) => void;
  /**
   * Up from the first row while an item is focused: hand focus to whatever
   * sits above the list (the home landing shelves). Focus is cleared here.
   */
  onExitTop?: () => void;
  /**
   * Bumped by the parent when focus enters from above; the first item takes
   * focus. 0 = never.
   */
  enterToken?: number;
}

/** Down one row, clamping to the last item when the row below is partially filled. */
function stepDown(i: number, cols: number, count: number): number {
  const nx = i + cols;
  if (nx < count) return nx;
  const lastRowStart = Math.floor((count - 1) / cols) * cols;
  return i < lastRowStart ? count - 1 : i;
}

export function useGridKeyboardNav({
  itemCount,
  columns,
  active,
  onOpen,
  onInspect,
  scrollToRow,
  onExitTop,
  enterToken = 0,
}: Options) {
  const { keybindingPreset } = usePreferences();
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // The key listener stays mounted across renders; read live values through a ref
  // so it never needs re-binding (and never goes stale).
  const ref = useRef({
    itemCount,
    columns,
    onOpen,
    onInspect,
    scrollToRow,
    onExitTop,
    preset: keybindingPreset,
    focusedIndex,
  });
  // Sync the latest values into the ref (written after commit, not during render). No dependency
  // array = syncing every commit, which is equivalent to the previous per-render sync.
  useEffect(() => {
    ref.current = {
      itemCount,
      columns,
      onOpen,
      onInspect,
      scrollToRow,
      onExitTop,
      preset: keybindingPreset,
      focusedIndex,
    };
  });

  // Entering from above (the landing shelves) lands on the first item. Only a
  // change counts: a view remounting with the last token must not focus.
  const seenToken = useRef(enterToken);
  useEffect(() => {
    if (enterToken === seenToken.current) return;
    seenToken.current = enterToken;
    if (ref.current.itemCount === 0) return;
    // Driven by the parent's token, not by user-advanced state, so setting
    // state here is the intended handshake.
    setFocusedIndex(0);
    ref.current.scrollToRow(0);
  }, [enterToken]);

  // Keep focus in range if the result set shrinks (filter/search change).
  useEffect(() => {
    if (focusedIndex >= itemCount) {
      // This update corrects the user-advanced focusedIndex to follow changes in the result count; synchronous setState is allowed to preserve behavior.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedIndex(itemCount > 0 ? itemCount - 1 : -1);
    }
  }, [itemCount, focusedIndex]);

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
      const {
        itemCount,
        columns,
        onOpen,
        onInspect,
        scrollToRow,
        onExitTop,
        preset,
        focusedIndex,
      } = ref.current;
      if (itemCount === 0) return;
      const cols = Math.max(1, columns);
      const b = GRID_BINDINGS[preset];

      const focused = focusedIndex >= 0 && focusedIndex < itemCount;
      // Inspect first, so an open chord that leaves shift unspecified (and so
      // also matches the shifted key) can never swallow it.
      if (onInspect && matchAny(e, b.inspect)) {
        if (focused) {
          e.preventDefault();
          onInspect(focusedIndex);
        }
        return;
      }
      if (matchAny(e, b.open)) {
        if (focused) {
          e.preventDefault();
          onOpen(focusedIndex);
        }
        return;
      }

      let next: number;
      if (matchAny(e, b.down))
        next = focusedIndex < 0 ? 0 : stepDown(focusedIndex, cols, itemCount);
      else if (matchAny(e, b.up)) {
        // On the first row with something above the list: leave upwards.
        if (onExitTop && focused && focusedIndex < cols) {
          e.preventDefault();
          setFocusedIndex(-1);
          onExitTop();
          return;
        }
        next = focusedIndex < 0 ? 0 : Math.max(0, focusedIndex - cols);
      } else if (matchAny(e, b.right))
        next = focusedIndex < 0 ? 0 : Math.min(itemCount - 1, focusedIndex + 1);
      else if (matchAny(e, b.left))
        next = focusedIndex < 0 ? 0 : Math.max(0, focusedIndex - 1);
      else return;

      e.preventDefault();
      if (next !== focusedIndex) setFocusedIndex(next);
      scrollToRow(Math.floor(next / cols));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return { focusedIndex, setFocusedIndex } as const;
}

/** Stable callback that scrolls a virtualizer to a row index without re-rendering. */
export function useScrollToRow(virtualizer: {
  scrollToIndex: (
    i: number,
    o?: { align?: "auto" | "start" | "center" | "end" },
  ) => void;
}) {
  return useCallback(
    (row: number) => virtualizer.scrollToIndex(row, { align: "auto" }),
    [virtualizer],
  );
}
