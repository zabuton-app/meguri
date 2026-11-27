// The folder view's moves from the keyboard and mouse: back (Alt+← /
// Backspace / the mouse's back button) and up (Alt+↑).
//
// Only while the list itself is in front, and never from inside a dialog or
// menu laid over it: Backspace is what a user presses to drop a tag chip in
// the bulk tag dialog, and a folder move there would clear the very selection
// the dialog is editing.
import {
  useCallback,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { LAYER_SELECTOR, isTyping } from "@/lib/keyTarget";

export function useFolderNavKeys({
  active,
  goBack,
  goUp,
}: {
  active: boolean;
  goBack: () => void;
  goUp: () => void;
}): { onMouseUp: (e: ReactMouseEvent) => void } {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (isTyping() || el?.closest(LAYER_SELECTOR)) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey;
      if (
        (plain && e.altKey && e.code === "ArrowLeft") ||
        (plain && !e.altKey && e.code === "Backspace")
      ) {
        e.preventDefault();
        goBack();
      } else if (plain && e.altKey && e.code === "ArrowUp") {
        e.preventDefault();
        goUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goBack, goUp]);

  const onMouseUp = useCallback(
    (e: ReactMouseEvent) => {
      // Button 3 is the mouse's "back" side button.
      if (!active || e.button !== 3) return;
      e.preventDefault();
      goBack();
    },
    [active, goBack],
  );
  return { onMouseUp };
}
