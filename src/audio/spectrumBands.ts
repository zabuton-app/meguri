// How the spectrum display carves the analyser's linear bins into the
// log-spaced bands it draws. Pure arithmetic, apart from the component so it
// can be tested on its own.

// Band edges, in Hz: what music actually occupies. Above ~16 kHz most
// material is empty and would only pad the right edge with silence; below
// 60 Hz the bins are wider than the bands and the leftmost bars would only
// repeat each other.
export const LOW_HZ = 60;
export const HIGH_HZ = 16_000;

/**
 * Bin index at the lower edge of each band (plus the top edge), log-spaced
 * between LOW_HZ and HIGH_HZ and clamped to the bins that exist, so on a low
 * sample rate the bands above Nyquist collapse onto `binCount` (and are
 * skipped by the draw) rather than reading past the data.
 */
export function bandEdges(
  bars: number,
  binCount: number,
  sampleRate: number,
): number[] {
  const hzPerBin = sampleRate / 2 / binCount;
  const edges: number[] = [];
  for (let i = 0; i <= bars; i++) {
    const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / bars);
    edges.push(Math.min(binCount, Math.max(0, Math.round(hz / hzPerBin))));
  }
  return edges;
}
