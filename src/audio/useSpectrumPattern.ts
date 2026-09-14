// The spectrum pattern to show, or null while the display is off (the
// preference, or the OS reduce-motion setting). Hosts look the pattern up in
// PATTERN_LAYOUT to place the display over the artwork; AudioSpectrum
// itself uses it to pick the drawer.
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { usePreferences } from "@/settings/PreferencesProvider";
import type { SpectrumPattern } from "./spectrumPatterns";

export function useSpectrumPattern(): SpectrumPattern | null {
  const { audioSpectrum, audioSpectrumPattern } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  return audioSpectrum && !reducedMotion ? audioSpectrumPattern : null;
}
