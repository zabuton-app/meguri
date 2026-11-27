// The search for one image inside the other, at one scale: a crop, or a copy
// with a border added. The smaller is searched for as a whole: over the whole
// of the larger at a small size, then a few times more, each at twice the
// scale of the last and only a few pixels round where the last put it.
//
// It finds a crop of any size, even one far smaller than the image it was cut
// from, which the coarse search (searchCoarse.ts) does not try.
import { bestIn, edgesIn, isFlat, scaled } from "./edges";
import { clamp, type Guess, type Rect, type Size } from "./geometry";
import { withOwned, type Cv, type CvMat } from "./opencv";

/** The long side of the larger image at the first, smallest level. */
const FIRST_LEVEL_SIDE = 400;
/** How far each level looks round where the last one put the template. */
const LEVEL_RADIUS = 3;
/** Past this long side, the template is cut to its central patch. */
const MAX_WHOLE_SIDE = 1024;
/** The long side of that patch. */
const PATCH_SIDE = 512;

/** Which image is searched for in the other. */
export type Contained = "a" | "b";

const fits = (inner: Size, outer: Size) =>
  inner.width <= outer.width && inner.height <= outer.height;

/** The image that fits inside the other; null for one size or crossing sizes. */
export function containedOf(a: Size, b: Size): Contained | null {
  if (a.width === b.width && a.height === b.height) return null;
  if (fits(b, a)) return "b";
  if (fits(a, b)) return "a";
  return null;
}

/**
 * The scales searched, coarse to full: the first brings the searched image's
 * long side down to FIRST_LEVEL_SIDE, each next one doubles, the last is 1.
 */
export function pyramidScales(target: Size): number[] {
  const first = Math.min(
    1,
    FIRST_LEVEL_SIDE / Math.max(target.width, target.height),
  );
  const scales = [first];
  while (scales[scales.length - 1] < 1)
    scales.push(Math.min(1, scales[scales.length - 1] * 2));
  return scales;
}

/**
 * B's offset in A from where the contained image's corner was found in the
 * other: found in A, B's corner sits there; found in B, A's does, so B's
 * corner is the same distance the other way. `+ 0` turns -0 into 0.
 */
export function offsetOf(
  contained: Contained,
  found: { x: number; y: number },
): { dx: number; dy: number } {
  return contained === "b"
    ? { dx: found.x + 0, dy: found.y + 0 }
    : { dx: -found.x + 0, dy: -found.y + 0 };
}

/**
 * The template at one level: the whole of it, or past MAX_WHOLE_SIDE its
 * central patch — the position is known to a few pixels by then, and the
 * whole template at full size would be a correlation of tens of megapixels
 * per position. One pixel in from its edge, so that every edge pixel of the
 * template is computed from real neighbours.
 */
function patchOf(templ: Size): Rect {
  const longSide = Math.max(templ.width, templ.height);
  const ratio = longSide > MAX_WHOLE_SIDE ? PATCH_SIDE / longSide : 1;
  const width = Math.max(1, Math.round(templ.width * ratio));
  const height = Math.max(1, Math.round(templ.height * ratio));
  const inset = width > 2 && height > 2 ? 1 : 0;
  return {
    x: Math.floor((templ.width - width) / 2) + inset,
    y: Math.floor((templ.height - height) / 2) + inset,
    width: width - 2 * inset,
    height: height - 2 * inset,
  };
}

/**
 * Where the contained image sits in the other, to the pixel, at scale 1.
 * `onLevel` hears each finished level. Null when it has no edges to go by.
 */
export function searchContained(
  cv: Cv,
  a: CvMat,
  b: CvMat,
  contained: Contained,
  onLevel?: (done: number) => void,
): Guess | null {
  const [source, target] = contained === "b" ? [b, a] : [a, b];
  const scales = pyramidScales({ width: target.cols, height: target.rows });
  let found = { x: 0, y: 0 };
  for (const [level, scale] of scales.entries()) {
    const flat = withOwned((own) => {
      const image = own(scaled(cv, target, scale));
      const templ = own(scaled(cv, source, scale));
      const patch = patchOf({ width: templ.cols, height: templ.rows });
      // Rounding is monotonic, so the template, no larger than the image at
      // full size, is no larger at any scale either.
      const maxX = image.cols - patch.width;
      const maxY = image.rows - patch.height;
      let range: Rect;
      if (level === 0) {
        range = { x: 0, y: 0, width: maxX + 1, height: maxY + 1 };
      } else {
        const ratio = scale / scales[level - 1];
        const cx = Math.round(found.x * ratio) + patch.x;
        const cy = Math.round(found.y * ratio) + patch.y;
        const x0 = clamp(cx - LEVEL_RADIUS, 0, maxX);
        const y0 = clamp(cy - LEVEL_RADIUS, 0, maxY);
        const x1 = clamp(cx + LEVEL_RADIUS, 0, maxX);
        const y1 = clamp(cy + LEVEL_RADIUS, 0, maxY);
        range = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
      }
      const edges = own(edgesIn(cv, templ, patch));
      if (level === 0 && isFlat(cv, edges)) return true;
      const window = own(
        edgesIn(cv, image, {
          x: range.x,
          y: range.y,
          width: range.width + patch.width - 1,
          height: range.height + patch.height - 1,
        }),
      );
      const best = bestIn(cv, window, edges);
      found = {
        x: range.x + best.x - patch.x,
        y: range.y + best.y - patch.y,
      };
      return false;
    });
    if (flat) return null;
    onLevel?.(level + 1);
  }
  return { ...offsetOf(contained, found), scale: 1, slack: 1 };
}
