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
