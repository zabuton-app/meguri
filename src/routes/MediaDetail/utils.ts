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

// Copies the image served at `src` (the media-server URL) to the clipboard.
// ClipboardItem only reliably accepts image/png, so any other decodable format
// (jpeg/webp/gif/avif/bmp) is re-encoded to PNG via canvas. Animated images copy
// their first frame only. Throws on fetch/decode/encode failure — callers surface it.
export async function copyImageToClipboard(src: string): Promise<void> {
  if (!src) throw new Error("empty media src");
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  const png = blob.type === "image/png" ? blob : await toPngBlob(blob);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": png }),
  ]);
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  // "from-image" applies EXIF orientation so the copied pixels match what <img> shows.
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "from-image",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("png encode failed"))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
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
