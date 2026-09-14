import { useCallback, useEffect, type RefObject } from "react";
import { useIsFullscreen } from "@/hooks/useIsFullscreen";

/**
 * Full screen for the player's root element.
 *
 * The player covers the window on its own; going full screen on top of that is
 * the user's call, not something entering playback decides for them. Leaving
 * full screen therefore just leaves full screen — playback carries on. And
 * whatever state the player is left in, unmounting must not strand the app
 * full screen.
 */
export function useFullscreen(rootRef: RefObject<HTMLElement | null>): {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  /** Leave full screen if in it; a no-op otherwise. */
  exitFullscreen: () => void;
} {
  const isFullscreen = useIsFullscreen(rootRef);
  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);
  useEffect(() => exitFullscreen, [exitFullscreen]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      exitFullscreen();
      return;
    }
    void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, [rootRef, exitFullscreen]);
  return { isFullscreen, toggleFullscreen, exitFullscreen };
}
