// The playback speeds the players offer (#280). A speed lasts for the file it
// was chosen on: the next file starts at normal speed.
export const PLAYBACK_SPEEDS: readonly number[] = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];
export const NORMAL_SPEED = 1;

/** The next speed up (`step` 1) or down (-1) from `current`, held at the ends. */
export function stepSpeed(current: number, step: 1 | -1): number {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  if (index === -1) return NORMAL_SPEED;
  const next = Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, index + step));
  return PLAYBACK_SPEEDS[next];
}

/**
 * The speed key a press is, if any: "<" slower, ">" faster (Shift+, and
 * Shift+. on US and JIS layouts, as on YouTube). Matched by the character
 * typed rather than the physical key: on layouts with "<" and ">" on a key of
 * their own, Shift+, types something else (";" in German).
 */
export function speedKeyStep(e: KeyboardEvent): 1 | -1 | null {
  if (e.key === ">") return 1;
  if (e.key === "<") return -1;
  return null;
}
