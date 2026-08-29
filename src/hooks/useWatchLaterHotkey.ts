// "W" toggles Watch Later on whatever the view considers current: the focused
// card/row in the list views, the open file in the detail view.
//
// The key drives the view's own WatchLaterButton through a ref rather than
// running its own mutation, so the toast, the effect, the disabled state and
// the cache invalidation all stay in the one control. This mirrors how
// Discovery already binds the same key (src/routes/Discover/index.tsx).
import { useEffect, type RefObject } from "react";

interface Options {
  /** Only handle the key while this view is foreground (no modal on top). */
  active: boolean;
  /** The WatchLaterButton to drive. Null while nothing is focused. */
  buttonRef: RefObject<HTMLButtonElement | null>;
}

export function useWatchLaterHotkey({ active, buttonRef }: Options): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyW" || e.ctrlKey || e.altKey || e.metaKey) return;
      // Auto-repeat from a held key would fire a burst of toggles and toasts.
      if (e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      // No focused item, or the button is still disabled waiting on the
      // collection id: swallow nothing, let the key fall through as a plain
      // keystroke. Clicking a disabled button is a no-op, so claiming the key
      // there would eat it while nothing can actually toggle.
      const button = buttonRef.current;
      if (!button || button.disabled) return;
      e.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, buttonRef]);
}
