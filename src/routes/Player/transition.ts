// Geometry of one item-to-item switch, as pure functions so the two legs can be
// checked without a browser that actually paints.
import type { CSSProperties } from "react";

/**
 * Both layers are parked at their start positions for one frame with animation
 * suppressed ("armed"), then released together ("running"). Without the parked
 * frame the browser would animate them *into* their start positions.
 */
export type Leg = "armed" | "running";

/** Style for the layer on its way out: sits still, then leaves. */
export function leavingStyle(
  leg: Leg,
  dir: 1 | -1,
  durationMs: number,
  fade: boolean,
  slide: boolean,
): CSSProperties {
  const gone = leg === "running";
  return {
    // Leaving goes against the direction of travel.
    transform: slide ? `translateX(${gone ? -100 * dir : 0}%)` : undefined,
    opacity: fade && gone ? 0 : 1,
    transition: leg === "armed" ? "none" : motion(durationMs),
  };
}

/** Style for the layer on its way in: waits off to the side, then arrives. */
export function enteringStyle(
  leg: Leg | null,
  dir: 1 | -1,
  durationMs: number,
  fade: boolean,
  slide: boolean,
): CSSProperties {
  if (leg == null) return {};
  const waiting = leg === "armed";
  return {
    transform: slide ? `translateX(${waiting ? 100 * dir : 0}%)` : undefined,
    opacity: fade && waiting ? 0 : 1,
    transition: waiting ? "none" : motion(durationMs),
  };
}

function motion(durationMs: number): string {
  return `opacity ${durationMs}ms ease-in-out, transform ${durationMs}ms ease-in-out`;
}
