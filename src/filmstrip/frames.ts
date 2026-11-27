// Where a filmstrip row takes its frames and how many fit.

/**
 * Times (whole seconds) of `count` frames spread evenly over `duration`, each
 * at the middle of its slice: no black first frame, no frame past the end.
 * The same spacing as the scene strips (SceneRail).
 */
export function frameTimes(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    Math.floor((duration * (i + 0.5)) / count),
  );
}

/** How many frames of `frameWidth` fit a strip, with `gap` between them. */
export function fitFrameCount(
  stripWidth: number,
  frameWidth: number,
  gap: number,
): number {
  return Math.max(1, Math.floor((stripWidth + gap) / (frameWidth + gap)));
}

/** A frame's width at the row's frame height, 16:9 when the size is unknown. */
export function frameWidthFor(
  rowFrameHeight: number,
  width: number | null,
  height: number | null,
): number {
  const aspect = width && height ? width / height : 16 / 9;
  return rowFrameHeight * aspect;
}
