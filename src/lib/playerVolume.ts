// Shared volume/mute persistence for the video and audio players.
//
// Deliberately not part of PreferencesProvider: volume changes at drag frequency,
// and MediaThumbnail consumes usePreferences(), so routing it through that context
// would re-render every visible grid thumbnail on every frame of a volume drag.
// Renderer-local, survives restarts. The keys pre-date the audio player, so users'
// existing settings carry over unchanged.
const VOLUME_KEY = "meguri.player.volume";
const MUTED_KEY = "meguri.player.muted";

export function loadVolume(): number {
  const raw = localStorage.getItem(VOLUME_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

export function loadMuted(): boolean {
  return localStorage.getItem(MUTED_KEY) === "1";
}

export function saveVolume(v: number, muted: boolean): void {
  localStorage.setItem(VOLUME_KEY, String(v));
  localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
}
