// Where nodes start before (or instead of) the force layout, and whether the
// layout needs to run at all. The first frame never waits for the layout: a
// node takes its cached position, else a spot near its already-placed
// neighbours, else a deterministic spot derived from its key.
import type { MediaGraph } from "./types";

export type Point = [number, number];
export type LayoutPlan = "none" | "fixed-partial" | "full";

/** Below this share of new nodes, the placed ones stay put while the new ones settle. */
export const PARTIAL_LAYOUT_SHARE = 0.2;

/** 32-bit FNV-1a: a stable pseudo-random value per key. */
function hash(key: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A spot in a disc of `radius`, the same for the same key every time. */
export function seedPosition(key: string, radius: number): Point {
  const angle = (hash(key) / 0xffffffff) * Math.PI * 2;
  const r = radius * Math.sqrt(hash(key, 1) / 0xffffffff);
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/** Radius the seeded disc gets for `n` nodes (roughly constant density). */
export function seedRadius(n: number): number {
  return 10 * Math.sqrt(Math.max(1, n));
}

/**
 * Positions for `pending` nodes. `known` holds positions already decided
 * (on screen, then from the cache); a pending node with known neighbours
 * starts at their centroid, nudged by its key so siblings do not stack.
 */
export function placeNodes(
  graph: MediaGraph,
  pending: string[],
  known: Map<string, Point>,
): Map<string, Point> {
  const out = new Map<string, Point>();
  const radius = seedRadius(graph.order);
  const nudge = radius * 0.05;
  for (const key of pending) {
    const cached = known.get(key);
    if (cached) {
      out.set(key, cached);
      continue;
    }
    let sx = 0;
    let sy = 0;
    let n = 0;
    graph.forEachNeighbor(key, (other) => {
      const p = known.get(other) ?? out.get(other);
      if (!p) return;
      sx += p[0];
      sy += p[1];
      n++;
    });
    if (n > 0) {
      const [jx, jy] = seedPosition(key, nudge);
      out.set(key, [sx / n + jx, sy / n + jy]);
    } else {
      out.set(key, seedPosition(key, radius));
    }
  }
  return out;
}

/** Whether to run the force layout, and how much of the graph it may move. */
export function layoutPlan(
  total: number,
  unplaced: number,
  relayout = false,
): LayoutPlan {
  if (relayout) return total > 0 ? "full" : "none";
  if (unplaced === 0) return "none";
  return unplaced / total < PARTIAL_LAYOUT_SHARE ? "fixed-partial" : "full";
}
