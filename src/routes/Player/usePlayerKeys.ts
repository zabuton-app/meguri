import { useEffect, useRef } from "react";
import { useCycleSpectrumPattern } from "@/audio/useSpectrumPatternHotkey";
import { bumpVolume, toggleMuted, VOLUME_STEP } from "@/hooks/useVolume";
import { matchAny, type NavBinding } from "@/settings/keybindings";

interface PlayerKeyActions {
  isImage: boolean;
  isAudio: boolean;
  togglePlay: () => void;
  openDetail: () => void;
  goNext: () => void;
  goPrev: () => void;
  toggleShuffle: () => void;
  toggleFullscreen: () => void;
  exit: () => void;
  navBinding: NavBinding;
  wake: () => void;
}

/**
 * Keyboard control, so the whole session can run without a mouse (FR-020).
 * Space and the arrows are left to the video player while a video is on
 * screen: it owns play/pause and seeking there. Images and audio (which has
 * no player element of its own here) are handled below.
 *
 * The listener is installed once; the actions are read through a ref so a
 * re-render never re-binds it.
 */
export function usePlayerKeys(actions: PlayerKeyActions): void {
  // V / Shift+V step through the spectrum patterns (see the hook).
  const cycleSpectrum = useCycleSpectrumPattern();
  const keyState = useRef({ ...actions, cycleSpectrum });
  useEffect(() => {
    keyState.current = { ...actions, cycleSpectrum };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      // Space and Enter belong to whatever control has focus. Swallowing them
      // here would stop the control bar's own buttons from ever activating,
      // which is the whole of "usable from the keyboard alone".
      if (
        el &&
        (e.code === "Space" || e.code === "Enter") &&
        (el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.getAttribute("role") === "button")
      )
        return;
      const s = keyState.current;
      // Shortcuts arrive on window, so the root's own onKeyDown never sees them
      // (focus usually sits on <body>). Waking here is what gives a keypress any
      // visible answer at all once the bar has hidden itself.
      s.wake();
      // The preset's paging chords step through the playlist, the same way they
      // page files in the detail view. Checked before the modifier guard because
      // a preset chord may itself carry one, and before the switch because the
      // video player yields these keys expecting someone else to act on them.
      if (matchAny(e, s.navBinding.prev)) {
        e.preventDefault();
        s.goPrev();
        return;
      }
      if (matchAny(e, s.navBinding.next)) {
        e.preventDefault();
        s.goNext();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.code) {
        case "Escape":
          // In full screen the browser's own Esc leaves it; closing the player
          // as well would collapse two steps into one keypress.
          if (document.fullscreenElement) return;
          e.preventDefault();
          s.exit();
          return;
        case "KeyF":
          e.preventDefault();
          s.toggleFullscreen();
          return;
        case "KeyN":
          e.preventDefault();
          s.goNext();
          return;
        case "KeyP":
          e.preventDefault();
          s.goPrev();
          return;
        case "KeyS":
          e.preventDefault();
          s.toggleShuffle();
          return;
        // Not gated on the item's kind: a picture has a detail view too.
        case "KeyI":
          e.preventDefault();
          s.openDetail();
          return;
        case "Space":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          s.togglePlay();
          return;
        case "ArrowRight":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          s.goNext();
          return;
        case "ArrowLeft":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          s.goPrev();
          return;
        // Volume follows the same split as play/pause and seeking: while a video
        // is on screen its own handler owns these keys, and acting here as well
        // would move the level twice per press.
        case "ArrowUp":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          bumpVolume(VOLUME_STEP);
          return;
        case "ArrowDown":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          bumpVolume(-VOLUME_STEP);
          return;
        case "KeyM":
          if (!s.isImage && !s.isAudio) return;
          e.preventDefault();
          toggleMuted();
          return;
        // Next spectrum pattern; with Shift, the one before (the detail view
        // binds the same key). Audio only: no other kind shows the display.
        case "KeyV":
          if (!s.isAudio || e.repeat) return;
          e.preventDefault();
          s.cycleSpectrum(e.shiftKey ? -1 : 1);
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
