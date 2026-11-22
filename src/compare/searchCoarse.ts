// The search for B as a whole at every scale: B resized to each scale tried
// (quarter octaves from a quarter to four times, and the ratio of the sizes),
// searched for at a small size in A with a margin of no edges round it, so B
// may sit anywhere that still overlaps A by a quarter of its size each way.
import { bestIn, edgesIn, isFlat, resized, scaled } from "./edges";
import { withOwned, type Cv, type CvMat } from "./opencv";
import { MAX_SCALE, type Guess, type Size } from "./geometry";

/** The long side of A at the coarse size. */
const COARSE_SIDE = 400;
/** How much of B must overlap A, each way, to be tried. */
const MIN_OVERLAP = 0.25;
/** The scales tried: this many to each doubling. */
const STEPS_PER_OCTAVE = 4;
/** A scale at which B's short side is under this is skipped. */
const MIN_COARSE_SIDE = 24;
/** How many of the best placements are kept. */
const KEPT = 3;

/** The scales of B tried: quarter octaves, and the sizes' ratios. */
export function scalesToTry(a: Size, b: Size): number[] {
  const steps = Math.round(Math.log2(MAX_SCALE) * STEPS_PER_OCTAVE);
  const scales = new Set<number>();
  for (let k = -steps; k <= steps; k++) scales.add(2 ** (k / STEPS_PER_OCTAVE));
  // A resized copy is exactly the ratio of the sizes, which the steps miss.
  for (const r of [a.width / b.width, a.height / b.height])
    if (r >= 1 / MAX_SCALE && r <= MAX_SCALE) scales.add(r);
  return [...scales];
}

/** The best few placements of B in A, best first. */
export function searchCoarse(cv: Cv, a: CvMat, b: CvMat): Guess[] {
  const c = Math.min(1, COARSE_SIDE / Math.max(a.cols, a.rows));
  // A pixel off at the coarse size, either way, and the rounding.
  const slack = Math.ceil(2 / c);
  return withOwned((own) => {
    const edgesA = own(edgesIn(cv, own(scaled(cv, a, c))));
    // B is resized for every scale tried: from a copy no larger than the
    // largest it is tried at, not from the full size each time.
    const workB = own(
      scaled(
        cv,
        b,
        Math.min(1, (COARSE_SIDE * MAX_SCALE) / Math.max(b.cols, b.rows)),
      ),
    );
    const found: (Guess & { score: number })[] = [];
    for (const scale of scalesToTry(
      { width: a.cols, height: a.rows },
      { width: b.cols, height: b.rows },
    )) {
      const width = Math.round(b.cols * scale * c);
      const height = Math.round(b.rows * scale * c);
      // Too small to tell from a speck, or larger than is worth searching.
      if (Math.min(width, height) < MIN_COARSE_SIDE) continue;
      if (Math.max(width, height) > COARSE_SIDE * MAX_SCALE) continue;
      const placed = withOwned((ownHere) => {
        const edgesB = ownHere(
          edgesIn(
            cv,
            // Area averaging at every scale, enlarging too, so that the
            // scales are ranked on edges made alike.
            ownHere(resized(cv, workB, width, height, cv.INTER_AREA)),
          ),
        );
        if (isFlat(cv, edgesB)) return null;
        // Padded after the edges are taken, so A's border adds no edge.
        const mx = Math.floor(width * (1 - MIN_OVERLAP));
        const my = Math.floor(height * (1 - MIN_OVERLAP));
        const padded = ownHere(new cv.Mat());
        cv.copyMakeBorder(
          edgesA,
          padded,
          my,
          my,
          mx,
          mx,
          cv.BORDER_CONSTANT,
          new cv.Scalar(0),
        );
        const best = bestIn(cv, padded, edgesB);
        return {
          dx: (best.x - mx) / c,
          dy: (best.y - my) / c,
          scale,
          slack,
          score: best.score,
        };
      });
      if (placed) found.push(placed);
    }
    return found
      .sort((p, q) => q.score - p.score)
      .slice(0, KEPT)
      .map(({ dx, dy, scale, slack }) => ({ dx, dy, scale, slack }));
  });
}
