// How the stage shows the two images: one shared zoom and pan for both, so a
// pixel of A and the pixel of B over it stay together.
import type { Size } from "./geometry";

export interface View {
  /** 1 fits the box in the stage. */
  zoom: number;
  /** Stage pixels from the stage's centre to the box's centre. */
  panX: number;
  panY: number;
}

export const FIT_VIEW: View = { zoom: 1, panX: 0, panY: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

/** The scale that fits `box` in the stage. */
export function fitScale(box: Size, stage: Size): number {
  if (box.width <= 0 || box.height <= 0) return 1;
  return Math.min(stage.width / box.width, stage.height / box.height);
}

/**
 * Zoom by `factor` keeping the point under the cursor in place. `at` is in
 * stage pixels from the stage's centre.
 */
export function zoomAt(
  view: View,
  factor: number,
  at: { x: number; y: number },
): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: at.x - (at.x - view.panX) * ratio,
    panY: at.y - (at.y - view.panY) * ratio,
  };
}
