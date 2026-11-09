interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Fit a 2× preview beside its anchor, never covering the area being scrubbed. */
export function scrubPreviewBounds(
  anchor: Rect,
  viewport: { width: number; height: number },
): Rect | null {
  const padding = 12;
  const gap = 12;
  if (anchor.width <= 0 || anchor.height <= 0) return null;
  const width = Math.max(0, viewport.width - padding * 2);
  const height = Math.max(0, viewport.height - padding * 2);
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  // Prefer vertical placement so the pointer can travel the entire thumbnail
  // width without moving toward the popup. Fall back to either side.
  const spaces = [
    { side: "above", width, height: anchor.top - gap - padding },
    { side: "below", width, height: viewport.height - bottom - gap - padding },
    { side: "right", width: viewport.width - right - gap - padding, height },
    { side: "left", width: anchor.left - gap - padding, height },
  ];
  let best: (typeof spaces)[number] | null = null;
  let scale = 0;
  for (const space of spaces) {
    const fit = Math.min(
      2,
      space.width / anchor.width,
      space.height / anchor.height,
    );
    if (fit > scale) {
      best = space;
      scale = fit;
    }
  }
  if (!best || scale <= 1) return null;
  const previewWidth = anchor.width * scale;
  const previewHeight = anchor.height * scale;
  let left = anchor.left + (anchor.width - previewWidth) / 2;
  let top = anchor.top + (anchor.height - previewHeight) / 2;
  if (best.side === "above") top = anchor.top - gap - previewHeight;
  if (best.side === "below") top = bottom + gap;
  if (best.side === "right") left = right + gap;
  if (best.side === "left") left = anchor.left - gap - previewWidth;
  return {
    left: Math.max(
      padding,
      Math.min(viewport.width - padding - previewWidth, left),
    ),
    top: Math.max(
      padding,
      Math.min(viewport.height - padding - previewHeight, top),
    ),
    width: previewWidth,
    height: previewHeight,
  };
}
