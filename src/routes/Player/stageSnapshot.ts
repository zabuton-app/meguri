// A still of whatever the stage was showing, so the outgoing item can stay on
// screen while the incoming one moves in.
//
// The alternative — keeping the real element mounted through the transition —
// means two <video> elements alive at once, each with its own window key
// handler. A snapshot costs one canvas and keeps exactly one live player.

export interface StageSnapshot {
  /** Identifies the item this still belongs to (for React keys). */
  key: string;
  /** Blurred backdrop the outgoing stage was drawn over. */
  backdropSrc?: string;
  /** Set for images: the URL that was on screen (already decoded). */
  imageSrc?: string;
  /** Set for video: a canvas holding the exact frame that was showing. */
  canvas?: HTMLCanvasElement;
  /** The media element's own transform (an image caught mid pan/zoom). */
  transform?: string;
}

/**
 * Freeze the media currently inside `root`. Returns null when there is nothing
 * to capture — no media yet, or a browser that will not hand over the frame —
 * and the caller then simply swaps without a transition.
 */
export function captureStage(
  root: HTMLElement | null,
  key: string,
  backdropSrc?: string,
): StageSnapshot | null {
  if (!root) return null;

  const video = root.querySelector("video");
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      try {
        // Cross-origin media taints the canvas, which blocks reading pixels back
        // out — drawing and displaying it is still allowed, and that is all this
        // needs.
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Styled here rather than where it is mounted: the element is this
        // module's to shape, and the component that shows it only borrows it.
        canvas.className = "h-full w-full object-contain";
        return { key, backdropSrc, canvas };
      } catch {
        // Nothing usable; fall through to the image case.
      }
    }
  }

  const img = root.querySelector<HTMLImageElement>(
    '[data-slot="player-media"]',
  );
  if (img?.currentSrc) {
    return {
      key,
      backdropSrc,
      imageSrc: img.currentSrc,
      // Keep the pan/zoom exactly where it had reached.
      transform: readTransform(img),
    };
  }

  return null;
}

function readTransform(el: HTMLElement): string | undefined {
  if (typeof window.getComputedStyle !== "function") return undefined;
  const t = window.getComputedStyle(el).transform;
  return t && t !== "none" ? t : undefined;
}
