// The search by feature matching (ORB): corners found in each image, at
// several sizes, wherever they are, are paired up, and the scale and offset
// most pairs agree on (RANSAC) is the guess. Because ORB finds features at
// several scales of each image, a pair can join features of different sizes:
// that is what lets the guess include a scale. Features are the weaker where
// corners are few or the shades are inverted.
import { scaled } from "./edges";
import { MAX_SCALE, type Guess } from "./geometry";
import { withOwned, type Cv, type CvMat } from "./opencv";

/** Features are found on copies whose long side is at most this. */
const FEATURE_SIDE = 1000;
/** How many features ORB keeps per image. */
const FEATURES = 1000;
/** A pair agrees with a placement within this many pixels of the copies. */
const VOTE_RADIUS = 2;
/** A guess needs this many agreeing pairs, and this share of all pairs. */
const MIN_VOTES = 4;
const MIN_VOTE_SHARE = 0.1;
/** Samples of two pairs tried. */
const RANSAC_SAMPLES = 1000;
/** A sample's two features must be at least this far apart in B (pixels). */
const MIN_SAMPLE_SPREAD = 10;

/** A feature of A paired with one of B. */
interface FeaturePair {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * The scale and offset of A = scale * B + offset that the most pairs agree
 * with (within `tolerance` pixels of A), by RANSAC: each sample of two pairs
 * proposes one, and the one most pairs fit is refitted to those pairs. Pairs
 * are sampled with a fixed seed, so the same images give the same answer.
 */
function fitSimilarity(
  pairs: FeaturePair[],
  tolerance: number,
): { scale: number; dx: number; dy: number; inliers: number } | null {
  const n = pairs.length;
  if (n < 2) return null;
  const fitting = (scale: number, dx: number, dy: number) =>
    pairs.filter(
      (p) =>
        Math.hypot(scale * p.bx + dx - p.ax, scale * p.by + dy - p.ay) <=
        tolerance,
    );
  let best: FeaturePair[] = [];
  let seed = 1;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  // Every sample when there are few pairs; a fixed number when many.
  const samples =
    n * (n - 1) <= 2 * RANSAC_SAMPLES
      ? pairs.flatMap((p, i) => pairs.slice(i + 1).map((q) => [p, q]))
      : Array.from({ length: RANSAC_SAMPLES }, () => [
          pairs[Math.floor(next() * n)],
          pairs[Math.floor(next() * n)],
        ]);
  for (const [p, q] of samples) {
    const db = Math.hypot(q.bx - p.bx, q.by - p.by);
    // Two features close together say little about the scale.
    if (db < MIN_SAMPLE_SPREAD) continue;
    const scale = Math.hypot(q.ax - p.ax, q.ay - p.ay) / db;
    if (scale < 1 / MAX_SCALE || scale > MAX_SCALE) continue;
    const inliers = fitting(scale, p.ax - scale * p.bx, p.ay - scale * p.by);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 2) return null;
  // Least squares over the agreeing pairs: centred, the scale is the ratio
  // of their dot products, and the offset follows from the centres.
  const mean = (pick: (p: FeaturePair) => number) =>
    best.reduce((sum, p) => sum + pick(p), 0) / best.length;
  const [ax, ay, bx, by] = [
    mean((p) => p.ax),
    mean((p) => p.ay),
    mean((p) => p.bx),
    mean((p) => p.by),
  ];
  let num = 0;
  let den = 0;
  for (const p of best) {
    num += (p.ax - ax) * (p.bx - bx) + (p.ay - ay) * (p.by - by);
    den += (p.bx - bx) ** 2 + (p.by - by) ** 2;
  }
  const scale = den > 0 ? num / den : 1;
  return {
    scale,
    dx: ax - scale * bx,
    dy: ay - scale * by,
    inliers: best.length,
  };
}

/** Feature pairs between A and B, in the pixels of the images given. */
function pairUp(cv: Cv, a: CvMat, b: CvMat): FeaturePair[] {
  return withOwned((own) => {
    const orb = own(new cv.ORB(FEATURES));
    const matcher = own(new cv.BFMatcher(cv.NORM_HAMMING, true));
    const mask = own(new cv.Mat());
    const [keysA, keysB] = [
      own(new cv.KeyPointVector()),
      own(new cv.KeyPointVector()),
    ];
    const [descA, descB] = [own(new cv.Mat()), own(new cv.Mat())];
    orb.detectAndCompute(a, mask, keysA, descA);
    orb.detectAndCompute(b, mask, keysB, descB);
    if (descA.rows === 0 || descB.rows === 0) return [];
    const matches = own(new cv.DMatchVector());
    matcher.match(descB, descA, matches);
    const pairs: FeaturePair[] = [];
    for (let i = 0; i < matches.size(); i++) {
      const m = matches.get(i);
      const pa = keysA.get(m.trainIdx).pt;
      const pb = keysB.get(m.queryIdx).pt;
      pairs.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
    }
    return pairs;
  });
}

/** The placement most feature pairs agree on; null when too few agree. */
export function searchFeatures(cv: Cv, a: CvMat, b: CvMat): Guess | null {
  const c = Math.min(
    1,
    FEATURE_SIDE / Math.max(a.cols, a.rows, b.cols, b.rows),
  );
  // Taken back to full-size pixels, where the tolerances are.
  const pairs = withOwned((own) =>
    pairUp(cv, own(scaled(cv, a, c)), own(scaled(cv, b, c))),
  ).map((p) => ({ ax: p.ax / c, ay: p.ay / c, bx: p.bx / c, by: p.by / c }));
  const fit = fitSimilarity(pairs, VOTE_RADIUS / c);
  if (
    !fit ||
    fit.inliers < MIN_VOTES ||
    fit.inliers < MIN_VOTE_SHARE * pairs.length
  )
    return null;
  return {
    dx: fit.dx,
    dy: fit.dy,
    scale: fit.scale,
    slack: Math.ceil((VOTE_RADIUS + 1) / c),
  };
}
