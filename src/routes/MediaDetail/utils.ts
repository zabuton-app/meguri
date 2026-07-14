// Two scene seconds within this many seconds are treated as the same "source frame" for
// the purpose of highlighting which scene/bookmark is currently set as the main thumbnail.
// Sized as half of the smallest practical granularity: auto scenes are integer-floored
// (1s grain) and bookmarks are float seconds derived from the player's current time
// (sub-second but stored verbatim). Half-of-a-second cleanly covers both without bleeding
// into adjacent integer seconds. Do not raise this without re-thinking auto-scene spacing.
export const THUMB_SAME_SOURCE_EPS = 0.5;

export function isSameThumbSource(
  thumbOffsetSec: number | null,
  sec: number,
): boolean {
  if (thumbOffsetSec == null) return false;
  return Math.abs(thumbOffsetSec - sec) < THUMB_SAME_SOURCE_EPS;
}

// Whether a per-scene/per-bookmark star should show the busy spinner. `pendingThumbSec`
// is undefined when idle, null when a revert-to-auto is in flight (lights up the currently
// active scene), or a real sec when a specific scene is being applied.
export function isThumbPendingFor(
  pendingThumbSec: number | null | undefined,
  sec: number,
  isMain: boolean,
): boolean {
  if (pendingThumbSec === undefined) return false;
  if (pendingThumbSec === null) return isMain;
  return isSameThumbSource(pendingThumbSec, sec);
}

// Player seek display: always shows the hours field when needed and guards against
// non-finite numbers (some streams expose Infinity as currentTime before metadata loads).
// Kept separate from `formatDuration` because its "0:00" fallback and isFinite check
// are specific to the live playback position display.
export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
