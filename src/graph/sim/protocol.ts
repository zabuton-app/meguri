// Messages between the graph view and its simulation worker. A "load" starts a
// generation: positions posted back carry it, so the view drops any that were
// computed for a graph it has since replaced.

import type { Dims } from "./engine";
import type { Physics } from "./physics";

export interface SimLoad {
  type: "load";
  gen: number;
  dims: Dims;
  /** `dims` coordinates per node, for node indices 0..n-1. */
  pos: Float32Array;
  /** Link k joins nodes links[2k] and links[2k+1]. */
  links: Uint32Array;
  /** Raised to, never lowered (see REHEAT_ALPHA). */
  alpha: number;
  /** Nodes held where the user holds them (a drag that outlived its graph). */
  pins: { index: number; at: number[] }[];
}

export interface SimPhysics {
  type: "physics";
  physics: Physics;
}

/** Hold node `index` at `at` (dims coordinates); omit it to let go. */
export interface SimPin {
  type: "pin";
  gen: number;
  index: number;
  at?: number[];
}

/** Heat: `alpha` only ever raises the current value; `alphaTarget` sets where it cools to. */
export interface SimHeat {
  type: "heat";
  alpha?: number;
  alphaTarget?: number;
}

export interface SimStop {
  type: "stop";
}

export type SimRequest = SimLoad | SimPhysics | SimPin | SimHeat | SimStop;

export type SimResponse =
  | { type: "positions"; gen: number; pos: Float32Array }
  /** The simulation cooled down and stopped ticking. */
  | { type: "idle"; gen: number };
