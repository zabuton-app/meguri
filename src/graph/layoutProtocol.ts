// Messages between the graph view and its layout worker. Arrays are typed so
// they can be transferred rather than copied.

export interface LayoutStart {
  type: "start";
  runId: number;
  /** [x0, y0, x1, y1, ...] for node indices 0..n-1. */
  xy: Float32Array;
  /** 1 = the node keeps its position. */
  fixed: Uint8Array;
  /** Edge i joins node ea[i] and node eb[i]. */
  ea: Uint32Array;
  eb: Uint32Array;
  weight: Float32Array;
  maxIterations: number;
  /** Wall-clock budget in ms. */
  budgetMs: number;
}

export interface LayoutStop {
  type: "stop";
}

export type LayoutRequest = LayoutStart | LayoutStop;

export type LayoutResponse =
  | { type: "positions"; runId: number; xy: Float32Array }
  | { type: "done"; runId: number; iterations: number };

/** Iterations one layout run allows, by node count. */
export function maxIterationsFor(n: number): number {
  if (n <= 200) return 1_500;
  if (n >= 5_000) return 300;
  return Math.round(1_500 - ((n - 200) / 4_800) * 1_200);
}

export const LAYOUT_BUDGET_MS = 15_000;
