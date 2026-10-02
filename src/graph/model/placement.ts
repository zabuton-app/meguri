// Where a node enters the simulation when it has no position yet, the way
// Obsidian seats new nodes: near the centroid of its already-seated
// neighbours (scattered by a jitter that grows with the number of newcomers),
// else in a ring just outside the nodes already there.
import type { MediaGraph } from "./types";
import type { Visibility } from "./visibility";

export type Point = [number, number];

/** Room given to each newcomer, in square units. */
const AREA_PER_NODE = 60 * 60;

/**
 * Positions for `pending` nodes. `shown` is what the simulation will have;
 * `seated` gives the position of a node that already has one (or nothing).
 * A newcomer seated earlier in the loop counts as seated for the ones after.
 */
export function placeNodes(
  graph: MediaGraph,
  pending: string[],
  shown: Pick<Visibility, "nodes" | "edges">,
  seated: (key: string) => Point | null,
  random: () => number = Math.random,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (pending.length === 0) return out;
  const where = (key: string) => out.get(key) ?? seated(key);

  let r2 = 0;
  const pendingSet = new Set(pending);
  for (const key of shown.nodes) {
    if (pendingSet.has(key)) continue;
    const p = seated(key);
    if (p) r2 = Math.max(r2, p[0] * p[0] + p[1] * p[1]);
  }
  const radius = Math.sqrt(r2);
  const area = AREA_PER_NODE * pending.length;
  const ring = Math.sqrt(area / Math.PI + radius * radius) - radius;
  const jitter = Math.sqrt(area);

  for (const key of pending) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    graph.forEachEdge(key, (edge, _attrs, a, b) => {
      if (!shown.edges.has(edge)) return;
      const p = where(a === key ? b : a);
      if (!p) return;
      sx += p[0];
      sy += p[1];
      n++;
    });
    if (n > 0) {
      out.set(key, [
        sx / n + (random() - 0.5) * jitter,
        sy / n + (random() - 0.5) * jitter,
      ]);
    } else {
      const angle = 2 * Math.PI * random();
      const r = radius + Math.sqrt(random()) * ring;
      out.set(key, [r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }
  return out;
}
