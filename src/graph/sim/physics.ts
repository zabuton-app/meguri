// The force simulation's constants and knobs, as in Obsidian's graph view:
// d3-force's forceX / forceY toward the origin, forceLink, a Barnes-Hut
// forceManyBody and forceCollide, stepped at 60 Hz while alpha cools from
// wherever the last reheat left it to ALPHA_MIN over about 300 ticks.

/** What the Forces settings map to (see graphSettings.ts). */
export interface Physics {
  centerStrength: number;
  /** Positive; the many-body force pushes with its negation. */
  repelStrength: number;
  /** Multiplies d3's default link strength (1 / the smaller degree). */
  linkStrength: number;
  linkDistance: number;
}

export const DEFAULT_PHYSICS: Physics = {
  centerStrength: 0.1,
  repelStrength: 1_000,
  linkStrength: 1,
  linkDistance: 250,
};

export const THETA = 0.9;
export const DISTANCE_MIN = 30;
export const COLLIDE_RADIUS = 60;
export const COLLIDE_STRENGTH = 0.5;
/** Share of a node's velocity kept from one tick to the next. */
export const VELOCITY_DECAY = 0.6;

export const ALPHA_MIN = 0.001;
export const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
export const TICK_MS = 1_000 / 60;
/** How hot a change of the data, the forces or a drag makes the simulation. */
export const REHEAT_ALPHA = 0.3;

/** The many-body strength d3 is given: a repel of less than 1 still pushes a little. */
export function chargeOf(p: Physics): number {
  return Math.abs(p.repelStrength) < 1 ? -1 : -p.repelStrength;
}
