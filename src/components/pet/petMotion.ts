// Where the pet is and how it moves: a single floor, gravity, a walk along
// the floor and a drag confined to the window. Pure, in viewport px; Pet.tsx
// owns the frame loop and writes the result to the DOM.

/** The strip the pet stands on: its left and right ends and its height. */
export interface PetFloor {
  left: number;
  right: number;
  /** Viewport y of the floor line (the sprite's bottom edge rests on it). */
  y: number;
}

export interface PetBody {
  /** Viewport x of the sprite's left edge. */
  x: number;
  /** Height of the sprite's bottom edge above the floor line. */
  lift: number;
  /** Downward speed, px/s. */
  vy: number;
}

/** px/s². Fast enough that a fall from the top of the window stays brief. */
export const GRAVITY = 2600;
/** Walking speed in sprite pixels per second (scaled with the pet). */
export const WALK_SPEED = 9;
/** Pointer travel (px) that turns a press into a drag instead of a click. */
export const DRAG_THRESHOLD = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max));
}

/** How far the sprite's left edge can travel along the floor. */
function floorSpan(floor: PetFloor, width: number): number {
  return Math.max(0, floor.right - floor.left - width);
}

export function clampToFloor(floor: PetFloor, width: number, x: number) {
  return clamp(x, floor.left, floor.left + floorSpan(floor, width));
}

/**
 * The saved position is a ratio of the floor's span rather than px, so a
 * resize (or the side peek docking) never leaves the pet outside the floor.
 */
export function xFromRatio(floor: PetFloor, width: number, ratio: number) {
  return floor.left + floorSpan(floor, width) * clamp(ratio, 0, 1);
}

export function ratioFromX(floor: PetFloor, width: number, x: number) {
  const span = floorSpan(floor, width);
  return span === 0 ? 0 : clamp((x - floor.left) / span, 0, 1);
}

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD;
}

/**
 * Where a drag puts the pet: under the pointer, kept inside the window and
 * never below the floor.
 */
export function dragTo(
  left: number,
  top: number,
  size: { width: number; height: number },
  viewportWidth: number,
  floor: PetFloor,
): Pick<PetBody, "x" | "lift"> {
  const x = clamp(left, 0, viewportWidth - size.width);
  const maxLift = Math.max(0, floor.y - size.height);
  const lift = clamp(floor.y - size.height - top, 0, maxLift);
  return { x, lift };
}

/**
 * One frame of falling. Released beside the floor (over the rail, or past
 * the docked side peek), the pet also drifts sideways onto it.
 */
export function stepFall(
  body: PetBody,
  dt: number,
  floor: PetFloor,
  width: number,
): PetBody & { landed: boolean } {
  const vy = body.vy + GRAVITY * dt;
  const lift = body.lift - vy * dt;
  const target = clampToFloor(floor, width, body.x);
  const drift = GRAVITY * 0.25 * dt;
  const x =
    Math.abs(target - body.x) <= drift
      ? target
      : body.x + Math.sign(target - body.x) * drift;
  if (lift <= 0) return { x: target, lift: 0, vy: 0, landed: true };
  return { x, lift, vy, landed: false };
}

/** One frame of walking; `hitEdge` when the floor's end stopped it. */
export function stepWalk(
  x: number,
  dir: -1 | 1,
  scale: number,
  dt: number,
  floor: PetFloor,
  width: number,
): { x: number; hitEdge: boolean } {
  const wanted = x + dir * WALK_SPEED * scale * dt;
  const next = clampToFloor(floor, width, wanted);
  return { x: next, hitEdge: next !== wanted };
}
