const PREFIX = "meguri.subtitleTrack.";
export const AUTO_SUBTITLE = -2;
export const SUBTITLES_OFF = -1;

export function subtitlePreferenceKey(wsId: string, relPath: string): string {
  return PREFIX + JSON.stringify([wsId, relPath]);
}

export function readSubtitlePreference(key: string | undefined): number {
  try {
    const saved = key ? localStorage.getItem(key) : null;
    const value = saved === null ? AUTO_SUBTITLE : Number(saved);
    return Number.isSafeInteger(value) && value >= AUTO_SUBTITLE
      ? value
      : AUTO_SUBTITLE;
  } catch {
    return AUTO_SUBTITLE;
  }
}

export function saveSubtitlePreference(
  key: string | undefined,
  track: number,
): void {
  if (!key) return;
  try {
    localStorage.setItem(key, String(track));
  } catch {
    // Playback still works if browser storage is unavailable.
  }
}

/**
 * Where the captions were dragged to (#377), one place for all clips. Each
 * axis is a fraction of the room the captions have to move in: 0 puts them
 * against the left or top edge, 1 against the right or bottom one. Relative
 * to the player, so it holds between the regular player and fullscreen.
 */
export interface SubtitlePosition {
  x: number;
  y: number;
}

const POSITION_KEY = "meguri.subtitlePosition";

const isFraction = (v: unknown): v is number =>
  typeof v === "number" && v >= 0 && v <= 1;

/** The saved position, or null for the default place above the control bar. */
export function readSubtitlePosition(): SubtitlePosition | null {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    const value: unknown = saved === null ? null : JSON.parse(saved);
    if (
      typeof value === "object" &&
      value !== null &&
      "x" in value &&
      "y" in value &&
      isFraction(value.x) &&
      isFraction(value.y)
    )
      return { x: value.x, y: value.y };
    return null;
  } catch {
    return null;
  }
}

export function saveSubtitlePosition(position: SubtitlePosition | null): void {
  try {
    if (position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    else localStorage.removeItem(POSITION_KEY);
  } catch {
    // The captions still move if browser storage is unavailable.
  }
}
