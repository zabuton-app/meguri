// Sizes, rectangles and the placement of B in A, shared by the alignment
// (worker) and the view.

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * Where B sits in A: A = scale * B + offset, no rotation. (dx, dy) is B's
 * top-left corner in A's pixels; scale is how much larger B is drawn.
 */
export interface Placement {
  dx: number;
  dy: number;
  scale: number;
}

/** A placement a search guessed, and how far off it may be (pixels of A). */
export interface Guess extends Placement {
  slack: number;
}

export const UNPLACED: Placement = { dx: 0, dy: 0, scale: 1 };

/** B may be up to this many times larger or smaller than A shows it. */
export const MAX_SCALE = 4;

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Where A sits in B (B = A / scale - offset / scale). Offsets are whole
 * pixels, so the inverted one is rounded; `+ 0` turns -0 into 0.
 */
export function invert(p: Placement): Placement {
  return {
    dx: Math.round(-p.dx / p.scale) + 0,
    dy: Math.round(-p.dy / p.scale) + 0,
    scale: 1 / p.scale,
  };
}

/** B's size as drawn in A. */
export const placedSize = (b: Size, p: Placement): Size => ({
  width: b.width * p.scale,
  height: b.height * p.scale,
});

/** The box A at the origin and B placed in it span together. */
export function spanOf(a: Size, b: Size, p: Placement): Rect {
  const { width, height } = placedSize(b, p);
  const x = Math.min(0, p.dx);
  const y = Math.min(0, p.dy);
  return {
    x,
    y,
    width: Math.max(a.width, p.dx + width) - x,
    height: Math.max(a.height, p.dy + height) - y,
  };
}

/** Where A and B placed in it overlap, in A's pixels; null when they do not. */
export function overlapOf(a: Size, b: Size, p: Placement): Rect | null {
  const { width, height } = placedSize(b, p);
  const x0 = Math.max(0, p.dx);
  const y0 = Math.max(0, p.dy);
  const x1 = Math.min(a.width, p.dx + width);
  const y1 = Math.min(a.height, p.dy + height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
