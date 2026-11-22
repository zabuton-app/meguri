// Finds where image B sits in image A: a scale and an offset, A = scale * B +
// offset (no rotation), by correlating the two images' edges (edges.ts).
//
// Three searches each guess the placement; none is right for every pair:
//
// - searchContained: one image inside the other at scale 1 (a crop), of any
//   size, to the pixel.
// - searchCoarse: B as a whole at every scale from a quarter to four times,
//   anywhere it still overlaps A by a quarter.
// - searchFeatures: ORB features paired up between the two, wherever they
//   are; strong on large shifts of detailed pictures.
//
// Every guess is then measured the same way at full size (refine.ts), and the
// highest score wins, so a wrong guess only loses.
import { UNPLACED, type Guess, type Size } from "./geometry";
import type { Cv, CvMat } from "./opencv";
import { refine, type AlignResult } from "./refine";
import { searchCoarse } from "./searchCoarse";
import { containedOf, pyramidScales, searchContained } from "./searchContained";
import { searchFeatures } from "./searchFeatures";

export type { AlignResult } from "./refine";

const sizeOf = (mat: CvMat): Size => ({ width: mat.cols, height: mat.rows });

/**
 * Align two single-channel images. `onStep` hears each finished step, for a
 * progress display: the contained search's levels, then the rest as one.
 * Throws only on an OpenCV failure.
 */
export function alignImages(
  cv: Cv,
  a: CvMat,
  b: CvMat,
  onStep?: (done: number, total: number) => void,
): AlignResult {
  const contained = containedOf(sizeOf(a), sizeOf(b));
  const levels = contained
    ? pyramidScales(sizeOf(contained === "b" ? a : b)).length
    : 1;
  const total = levels + 1;

  const guesses: Guess[] = [];
  if (contained) {
    const guess = searchContained(cv, a, b, contained, (done) =>
      onStep?.(done, total),
    );
    if (guess) guesses.push(guess);
  }
  guesses.push(...searchCoarse(cv, a, b));
  const featured = searchFeatures(cv, a, b);
  if (featured) guesses.push(featured);
  if (!contained) onStep?.(levels, total);

  let best: AlignResult = { ...UNPLACED, score: 0 };
  for (const guess of guesses) {
    const result = refine(cv, a, b, guess);
    if (result && result.score > best.score) best = result;
  }
  onStep?.(total, total);
  return best;
}
