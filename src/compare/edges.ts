// The primitives every search is built from: resizing, edge maps, and
// finding a template in a window by normalized cross-correlation (OpenCV's
// matchTemplate with TM_CCOEFF_NORMED).
//
// What is correlated is each image's edges (the gradient's strength), not its
// shades: two versions of one picture often differ in brightness or polarity
// — a screenshot of the same screen in a dark and a light theme, an exposure
// change, an inverted copy — and correlating shades then scores the true
// position low or even negative. An edge stays where it is either way.
import type { Rect } from "./geometry";
import { withOwned, type Cv, type CvMat } from "./opencv";

/** A template whose edge strengths spread less than this (of 255) has none. */
const FLAT_STDDEV = 1;

/**
 * `mat` at `scale`. At 1 this is a view of `mat` itself, not a copy: a full
 * size copy of a large image is what runs the wasm heap out.
 */
export function scaled(cv: Cv, mat: CvMat, scale: number): CvMat {
  if (scale === 1) return mat.roi(new cv.Rect(0, 0, mat.cols, mat.rows));
  return resized(cv, mat, mat.cols * scale, mat.rows * scale);
}

/**
 * `mat` resized to (about) `width` x `height`, at least one pixel a side.
 * By default area averaging to shrink (no aliasing) and bilinear to enlarge.
 */
export function resized(
  cv: Cv,
  mat: CvMat,
  width: number,
  height: number,
  interpolation?: number,
): CvMat {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const how =
    interpolation ??
    (w < mat.cols || h < mat.rows ? cv.INTER_AREA : cv.INTER_LINEAR);
  const out = new cv.Mat();
  try {
    cv.resize(mat, out, new cv.Size(w, h), 0, 0, how);
    return out;
  } catch (err) {
    out.delete();
    throw err;
  }
}

/** The whole of `mat`, as a rectangle. */
export const whole = (mat: CvMat): Rect => ({
  x: 0,
  y: 0,
  width: mat.cols,
  height: mat.rows,
});

/**
 * The edge strength of `mat` inside `rect`: |d/dx| + |d/dy| (Sobel), halved
 * to fit a byte. A pixel of `mat` around the rect is read where there is one,
 * so the rect's own border pixels are computed from their real neighbours.
 * Only the rect is computed, never the whole of a large image: Sobel's 16-bit
 * intermediates are four bytes a pixel more.
 */
export function edgesIn(cv: Cv, mat: CvMat, rect: Rect = whole(mat)): CvMat {
  const x0 = Math.max(0, rect.x - 1);
  const y0 = Math.max(0, rect.y - 1);
  const x1 = Math.min(mat.cols, rect.x + rect.width + 1);
  const y1 = Math.min(mat.rows, rect.y + rect.height + 1);
  return withOwned((own) => {
    const view = own(mat.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0)));
    const gx = own(new cv.Mat());
    const gy = own(new cv.Mat());
    const edges = own(new cv.Mat());
    cv.Sobel(view, gx, cv.CV_16S, 1, 0);
    cv.Sobel(view, gy, cv.CV_16S, 0, 1);
    cv.convertScaleAbs(gx, gx);
    cv.convertScaleAbs(gy, gy);
    cv.addWeighted(gx, 0.5, gy, 0.5, 0, edges);
    const inner = own(
      edges.roi(new cv.Rect(rect.x - x0, rect.y - y0, rect.width, rect.height)),
    );
    return inner.clone();
  });
}

/**
 * Whether `mat` is all one value. A template without edges (one shade, or a
 * smooth gradient) correlates the same everywhere, and a search would report
 * the first position it tried at a perfect score.
 */
export function isFlat(cv: Cv, mat: CvMat): boolean {
  return withOwned((own) => {
    const mean = own(new cv.Mat());
    const stddev = own(new cv.Mat());
    cv.meanStdDev(mat, mean, stddev);
    return stddev.doubleAt(0, 0) < FLAT_STDDEV;
  });
}

export interface Found {
  /** The template's corner, as an offset into the window. */
  x: number;
  y: number;
  /** The correlation there, -1..1. */
  score: number;
}

/**
 * The best match of `templ` in `window`. With `subpixel`, the position is
 * taken between pixels: a scale measured from two positions a few hundred
 * pixels apart is off by a visible fraction when each is off by a pixel.
 */
export function bestIn(
  cv: Cv,
  window: CvMat,
  templ: CvMat,
  subpixel = false,
): Found {
  return withOwned((own) => {
    const result = own(new cv.Mat());
    cv.matchTemplate(window, templ, result, cv.TM_CCOEFF_NORMED);
    const { maxVal: score, maxLoc } = cv.minMaxLoc(result);
    const { x, y } = maxLoc;
    if (!subpixel) return { x, y, score };
    // A parabola through the best score and its neighbours, each way.
    const peak = (at: (d: number) => number, i: number, n: number) => {
      if (i <= 0 || i >= n - 1) return 0;
      const [l, c, r] = [at(-1), at(0), at(1)];
      const curve = l - 2 * c + r;
      return curve < 0
        ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * curve)))
        : 0;
    };
    return {
      x: x + peak((d) => result.floatAt(y, x + d), x, result.cols),
      y: y + peak((d) => result.floatAt(y + d, x), y, result.rows),
      score,
    };
  });
}
