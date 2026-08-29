// Ken Burns motion for still images in the playlist player.
//
// Only `transform` is animated, so the whole effect stays on the compositor and
// never triggers layout or paint. The geometry rule that keeps the frame full:
// scaling by S leaves (S - 1) / 2 of the box hanging over each edge, so a
// translation of at most that much can never pull an edge into view.

export const MIN_SCALE = 1.15;

/** Extra zoom travel on top of MIN_SCALE (the "how much it breathes" range). */
const ZOOM_AMPLITUDE_MIN = 0.08;
const ZOOM_AMPLITUDE_MAX = 0.22;

/** Fraction of the available overhang the pan actually uses. */
const PAN_TRAVEL_MIN = 0.3;
const PAN_TRAVEL_MAX = 0.85;

export interface KenBurnsSpec {
  fromScale: number;
  toScale: number;
  /** Percent of the element's own size, applied outside the scale. */
  fromXY: [number, number];
  toXY: [number, number];
  durationMs: number;
}

export type Rng = () => number;

/**
 * How far the element may be translated at this scale before an edge shows,
 * in percent of its own size (translate % resolves against the unscaled box).
 */
export function maxOffsetPercent(scale: number): number {
  return ((scale - 1) / 2) * 100;
}

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Pick one image's motion. Direction, distance and whether it pushes in or
 * pulls out are all random, so the same image does not move the same way twice.
 */
export function createKenBurnsSpec(
  durationMs: number,
  rng: Rng = Math.random,
): KenBurnsSpec {
  const amplitude = between(rng, ZOOM_AMPLITUDE_MIN, ZOOM_AMPLITUDE_MAX);
  const zoomIn = rng() < 0.5;
  const fromScale = zoomIn ? MIN_SCALE : MIN_SCALE + amplitude;
  const toScale = zoomIn ? MIN_SCALE + amplitude : MIN_SCALE;

  // A single direction, travelled end to end: the pan reads as one movement
  // rather than a wander (spec FR-023).
  const angle = rng() * Math.PI * 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const travel = between(rng, PAN_TRAVEL_MIN, PAN_TRAVEL_MAX);

  const fromReach = -maxOffsetPercent(fromScale) * travel;
  const toReach = maxOffsetPercent(toScale) * travel;

  return {
    fromScale,
    toScale,
    fromXY: [ux * fromReach, uy * fromReach],
    toXY: [ux * toReach, uy * toReach],
    durationMs,
  };
}

function transformOf(xy: [number, number], scale: number): string {
  // translate before scale: the percentage stays relative to the unscaled box,
  // which is what makes maxOffsetPercent() an exact bound.
  return `translate(${xy[0].toFixed(3)}%, ${xy[1].toFixed(3)}%) scale(${scale.toFixed(4)})`;
}

/** Keyframes for Element.animate(). */
export function kenBurnsKeyframes(spec: KenBurnsSpec): Keyframe[] {
  return [
    { transform: transformOf(spec.fromXY, spec.fromScale) },
    { transform: transformOf(spec.toXY, spec.toScale) },
  ];
}

/** The still transform to apply when motion is off (keeps framing identical). */
export function staticTransform(): string {
  return "translate(0%, 0%) scale(1)";
}
