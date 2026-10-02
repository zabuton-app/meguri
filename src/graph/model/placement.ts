// Where a node enters the simulation when it has no position yet, the way
// Obsidian seats new nodes: near the centroid of its already-seated
// neighbours (scattered by a jitter that grows with the number of newcomers),
// else in a ring just outside the nodes already there. In 3D the ring is a
// spherical shell and the room per newcomer a cube rather than a square.
import type { GraphDims } from "@shared/ipc/graph";
import type { MediaGraph } from "./types";
import type { Visibility } from "./visibility";

/** A position: two coordinates in 2D, three in 3D. */
export type Point = number[];

/** Room given to each newcomer: a 60-unit square, or cube in 3D. */
const SIDE_PER_NODE = 60;

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
  dims: GraphDims = 2,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (pending.length === 0) return out;
  const where = (key: string) => out.get(key) ?? seated(key);

  let r2 = 0;
  const pendingSet = new Set(pending);
  for (const key of shown.nodes) {
    if (pendingSet.has(key)) continue;
    const p = seated(key);
    if (p)
      r2 = Math.max(
        r2,
        p.reduce((s, v) => s + v * v, 0),
      );
  }
  const radius = Math.sqrt(r2);
  // The newcomers' room, as an area (2D) or a volume (3D); the ring (shell)
  // is as thick as it takes to hold it outside the nodes already there.
  const room = Math.pow(SIDE_PER_NODE, dims) * pending.length;
  const ring =
    dims === 3
      ? Math.cbrt((3 * room) / (4 * Math.PI) + radius ** 3) - radius
      : Math.sqrt(room / Math.PI + radius * radius) - radius;
  const jitter = Math.pow(room, 1 / dims);

  for (const key of pending) {
    const sum = new Array<number>(dims).fill(0);
    let n = 0;
    graph.forEachEdge(key, (edge, _attrs, a, b) => {
      if (!shown.edges.has(edge)) return;
      const p = where(a === key ? b : a);
      if (!p) return;
      for (let c = 0; c < dims; c++) sum[c] += p[c];
      n++;
    });
    if (n > 0) {
      out.set(
        key,
        sum.map((s) => s / n + (random() - 0.5) * jitter),
      );
    } else if (dims === 3) {
      // A uniform direction, at a distance into the shell.
      const cos = 2 * random() - 1;
      const sin = Math.sqrt(1 - cos * cos);
      const angle = 2 * Math.PI * random();
      const r = radius + Math.cbrt(random()) * ring;
      out.set(key, [
        r * sin * Math.cos(angle),
        r * sin * Math.sin(angle),
        r * cos,
      ]);
    } else {
      const angle = 2 * Math.PI * random();
      const r = radius + Math.sqrt(random()) * ring;
      out.set(key, [r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }
  return out;
}
