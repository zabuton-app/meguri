// Stepping through the spectrum patterns from the keyboard: V for the next
// one, Shift+V for the one before, wrapping at either end in the Settings
// order. One hook does the stepping (the playlist player folds it into its
// own key handler); the other binds the key for a view that has no handler
// of its own (the detail view and the side peek, while they show audio).
//
// Asking for another pattern while the display is off means wanting to see
// it, so the same press turns it on. Inert under the OS reduce-motion
// setting, where the spectrum buttons are disabled too: nothing would be
// seen, and the preference would change behind the user's back.
import { useCallback, useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { usePreferences } from "@/settings/PreferencesProvider";
import { cycleSpectrumPattern } from "./spectrumPatterns";

export function useCycleSpectrumPattern(): (dir: 1 | -1) => void {
  const {
    audioSpectrum,
    setAudioSpectrum,
    audioSpectrumPattern,
    setAudioSpectrumPattern,
  } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  // The current pattern is kept in a ref and advanced on the spot, so two
  // quick presses both land even when they arrive before a re-render.
  const patternRef = useRef(audioSpectrumPattern);
  useEffect(() => {
    patternRef.current = audioSpectrumPattern;
  }, [audioSpectrumPattern]);
  return useCallback(
    (dir: 1 | -1) => {
      if (reducedMotion) return;
      const next = cycleSpectrumPattern(patternRef.current, dir);
      patternRef.current = next;
      setAudioSpectrumPattern(next);
      if (!audioSpectrum) setAudioSpectrum(true);
    },
    [audioSpectrum, reducedMotion, setAudioSpectrum, setAudioSpectrumPattern],
  );
}

/** Is this the spectrum key: a plain V (Shift allowed) with no other
 *  modifier, not auto-repeating, and not typed into a field? */
export function isSpectrumPatternKey(e: KeyboardEvent): boolean {
  if (e.code !== "KeyV" || e.ctrlKey || e.altKey || e.metaKey) return false;
  // Each step rebuilds the display (and its bitmap); a held key would do
  // that at the OS repeat rate for nothing anyone can follow.
  if (e.repeat) return false;
  const el = document.activeElement as HTMLElement | null;
  if (
    el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable)
  )
    return false;
  return true;
}

/** Binds V / Shift+V on the window while `active` (a view showing audio). */
export function useSpectrumPatternHotkey(active: boolean): void {
  const cycle = useCycleSpectrumPattern();
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSpectrumPatternKey(e)) return;
      e.preventDefault();
      cycle(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cycle]);
}
