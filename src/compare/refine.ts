// Every search ends here: a guessed placement is measured at full size where
// the two images overlap. A patch in each half of the overlap is found in A;
// the distance between the two, in A against in B, is the scale, and either
// one then gives the offset. The score is theirs, so the candidates of every
// search are scored alike and the best of them can be picked.
import { bestIn, edgesIn, isFlat, resized } from "./edges";
import { clamp, type Guess, type Placement, type Rect } from "./geometry";
import { withOwned, type Cv, type CvMat } from "./opencv";

export interface AlignResult extends Placement {
  /** The correlation of the two images' edges where B was placed, -1..1. */
  score: number;
}

/** How far the second pass looks round the first pass's answer. */
const REFINE_RADIUS = 3;
/** Each patch is cut to its central part, at most this long a side. */
const MAX_PATCH = 1024;
/** The patches are at least this many pixels a side. */
const MIN_PATCH = 16;

/** A pixel of B's patch and where it was found in A. */
interface Landmark {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  score: number;
}

/**
 * Where a patch of B lands in A. `rect` is where the guess puts it, in A's
 * pixels; the matching part of B is resized by the scale and searched for
 * within the guess's slack of there. Null when it has no edges to go by.
 */
function landmark(
  cv: Cv,
  a: CvMat,
  b: CvMat,
  rect: Rect,
  guess: Guess,
): Landmark | null {
  const { scale, slack } = guess;
  // The patch in B's pixels, with a margin so its edges have neighbours.
  const bx = (rect.x - guess.dx) / scale;
  const by = (rect.y - guess.dy) / scale;
  const x0 = Math.max(0, Math.floor(bx) - 2);
  const y0 = Math.max(0, Math.floor(by) - 2);
  const x1 = Math.min(b.cols, Math.ceil(bx + rect.width / scale) + 2);
  const y1 = Math.min(b.rows, Math.ceil(by + rect.height / scale) + 2);
  return withOwned((own) => {
    const crop = own(b.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0)));
    const sized = own(resized(cv, crop, (x1 - x0) * scale, (y1 - y0) * scale));
    const ox = clamp(Math.round((bx - x0) * scale), 0, sized.cols - rect.width);
    const oy = clamp(
      Math.round((by - y0) * scale),
      0,
      sized.rows - rect.height,
    );
    if (ox < 0 || oy < 0) return null;
    const templ = own(
      edgesIn(cv, sized, {
        x: ox,
        y: oy,
        width: rect.width,
        height: rect.height,
      }),
    );
    if (isFlat(cv, templ)) return null;
    const searched = {
      x: rect.x - slack,
      y: rect.y - slack,
      width: rect.width + 2 * slack,
      height: rect.height + 2 * slack,
    };
    const best = bestIn(cv, own(edgesIn(cv, a, searched)), templ, true);
    return {
      ax: searched.x + best.x,
      ay: searched.y + best.y,
      // The B pixel the template's corner was cut at.
      bx: x0 + ox / scale,
      by: y0 + oy / scale,
      score: best.score,
    };
  });
}

/** The two halves of `rect` along its longer side, each cut to its centre. */
function halvesOf(rect: Rect): Rect[] {
  const across = rect.width >= rect.height;
  const cut = Math.floor((across ? rect.width : rect.height) / 2);
  const halves: Rect[] = across
    ? [
        { ...rect, width: cut },
        { ...rect, x: rect.x + cut, width: rect.width - cut },
      ]
    : [
        { ...rect, height: cut },
        { ...rect, y: rect.y + cut, height: rect.height - cut },
      ];
  return halves.map((r) => {
    const width = Math.min(r.width, MAX_PATCH);
    const height = Math.min(r.height, MAX_PATCH);
    return {
      x: r.x + Math.floor((r.width - width) / 2),
      y: r.y + Math.floor((r.height - height) / 2),
      width,
      height,
    };
  });
}

/**
 * The guess measured at full size. Twice: the second pass, from the first's
 * answer, looks only a few pixels round. When one half has no edges, the
 * other gives the offset at the guessed scale. Null when the overlap is too
 * small or has no edges to go by.
 */
export function refine(
  cv: Cv,
  a: CvMat,
  b: CvMat,
  guess: Guess,
): AlignResult | null {
  let current = guess;
  let score = 0;
  for (let pass = 0; pass < 2; pass++) {
    const { dx, dy, scale, slack } = current;
    // The overlap, kept `slack` in from its edges so every position searched
    // stays inside both images.
    const x0 = Math.ceil(Math.max(0, dx) + slack);
    const y0 = Math.ceil(Math.max(0, dy) + slack);
    const x1 = Math.floor(Math.min(a.cols, dx + b.cols * scale) - slack);
    const y1 = Math.floor(Math.min(a.rows, dy + b.rows * scale) - slack);
    if (x1 - x0 < 2 * MIN_PATCH || y1 - y0 < MIN_PATCH) return null;
    const overlap = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const found = halvesOf(overlap)
      .map((r) => landmark(cv, a, b, r, current))
      .filter((p) => p !== null);
    if (found.length === 0) return null;
    let next = scale;
    if (found.length === 2) {
      const [p, q] = found;
      const inB = Math.hypot(q.bx - p.bx, q.by - p.by);
      if (inB > 0) next = Math.hypot(q.ax - p.ax, q.ay - p.ay) / inB;
    }
    const p = found[0];
    current = {
      dx: p.ax - next * p.bx,
      dy: p.ay - next * p.by,
      scale: next,
      slack: REFINE_RADIUS,
    };
    score = found.reduce((sum, f) => sum + f.score, 0) / found.length;
  }
  let { scale } = current;
  // A scale that moves no pixel of B by half a pixel is no scale at all.
  if (Math.abs(scale - 1) * Math.max(b.cols, b.rows) < 0.5) scale = 1;
  // `+ 0` turns -0 into 0.
  return {
    dx: Math.round(current.dx) + 0,
    dy: Math.round(current.dy) + 0,
    scale,
    score,
  };
}
