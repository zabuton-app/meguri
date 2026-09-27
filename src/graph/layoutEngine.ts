// ForceAtlas2 over flat matrices: what the layout worker runs, kept free of
// worker plumbing so it can be tested directly. Driving the package's single
// iteration on matrices built once (rather than its graph-level API, which
// rebuilds them per call) is what lets a dragged node be moved between
// iterations: its coordinates and "fixed" flag are written straight into the
// node matrix.
import iterate from "graphology-layout-forceatlas2/iterate.js";
import DEFAULTS from "graphology-layout-forceatlas2/defaults.js";

// Matrix layout of graphology-layout-forceatlas2 (see its helpers.js). The
// edge matrix holds, per edge, both ends as node-matrix offsets and a weight.
const PPN = 10;
const NODE_X = 0;
const NODE_Y = 1;
const NODE_MASS = 6;
const NODE_CONVERGENCE = 7;
const NODE_SIZE = 8;
const NODE_FIXED = 9;

export interface EngineInput {
  /** [x0, y0, x1, y1, ...] for node indices 0..n-1. */
  xy: Float32Array;
  /** 1 = the node keeps its position. */
  fixed: Uint8Array;
  ea: Uint32Array;
  eb: Uint32Array;
  weight: Float32Array;
}

/** The package's inferSettings(order), plus the choices research.md R2 made. */
export function settingsFor(n: number): Record<string, number | boolean> {
  return {
    ...DEFAULTS,
    strongGravityMode: true,
    gravity: 0.05,
    scalingRatio: 10,
    slowDown: 1 + Math.log(Math.max(1, n)),
    linLogMode: true,
    edgeWeightInfluence: 1,
    barnesHutOptimize: n > 1_000,
  };
}

/**
 * Settings while a node is held. LinLog attraction grows only with the log of
 * a link's length and the inferred slow-down is strong, which settles large
 * graphs well but makes neighbours barely follow a dragged node; plain linear
 * attraction at full speed makes them come along. Letting go returns to the
 * base settings, so the graph relaxes back into its usual shape. Applied to a
 * whole graph it would contract every cluster, so it is used only when the
 * caller freed just the dragged node's neighbourhood.
 */
function heldSettings(
  base: Record<string, number | boolean>,
): Record<string, number | boolean> {
  // A coarser Barnes-Hut (Gephi uses 1.2) nearly triples the iteration rate,
  // which is what keeps the neighbours in step with the pointer at 5,000
  // nodes; the precision it gives up does not show while things move.
  return { ...base, linLogMode: false, slowDown: 1, barnesHutTheta: 1 };
}

export class LayoutEngine {
  readonly n: number;
  private readonly nodes: Float32Array;
  private readonly edges: Float32Array;
  private readonly settings: Record<string, number | boolean>;
  private readonly heldSettings: Record<string, number | boolean>;
  /** Pinned by the caller at the start (not by a drag). */
  private readonly pinned: Uint8Array;
  private held: number | null = null;
  /** The hold may use the held-time settings (see LayoutStart.hold.local). */
  private local = false;

  constructor(input: EngineInput) {
    const n = input.fixed.length;
    this.n = n;
    this.pinned = input.fixed;
    this.settings = settingsFor(n);
    this.heldSettings = heldSettings(this.settings);
    this.nodes = new Float32Array(n * PPN);
    for (let i = 0; i < n; i++) {
      const j = i * PPN;
      this.nodes[j + NODE_X] = input.xy[i * 2];
      this.nodes[j + NODE_Y] = input.xy[i * 2 + 1];
      this.nodes[j + NODE_MASS] = 1;
      this.nodes[j + NODE_CONVERGENCE] = 1;
      this.nodes[j + NODE_SIZE] = 1;
      this.nodes[j + NODE_FIXED] = input.fixed[i] === 1 ? 1 : 0;
    }
    const edges: number[] = [];
    for (let e = 0; e < input.ea.length; e++) {
      const a = input.ea[e];
      const b = input.eb[e];
      if (a === b || a >= n || b >= n) continue;
      const w = input.weight[e] ?? 1;
      // Mass is the weighted degree, as the package's own setup makes it.
      this.nodes[a * PPN + NODE_MASS] += w;
      this.nodes[b * PPN + NODE_MASS] += w;
      edges.push(a * PPN, b * PPN, w);
    }
    this.edges = Float32Array.from(edges);
  }

  /** Nodes free to move (for judging when the layout has settled). */
  get freeCount(): number {
    let free = 0;
    for (let i = 0; i < this.n; i++)
      if (this.nodes[i * PPN + NODE_FIXED] !== 1) free++;
    return free;
  }

  get holding(): boolean {
    return this.held != null;
  }

  /** Run `iterations` steps; returns the summed distance the nodes moved. */
  step(iterations: number): number {
    const before = this.positions();
    const settings =
      this.held != null && this.local ? this.heldSettings : this.settings;
    for (let k = 0; k < iterations; k++)
      iterate(settings, this.nodes, this.edges);
    let moved = 0;
    for (let i = 0; i < this.n; i++) {
      const j = i * PPN;
      moved += Math.hypot(
        this.nodes[j + NODE_X] - before[i * 2],
        this.nodes[j + NODE_Y] - before[i * 2 + 1],
      );
    }
    return moved;
  }

  /** Take hold of node `index` at (x, y): the node the user is dragging. */
  hold(index: number, x: number, y: number, local = false): void {
    if (index < 0 || index >= this.n) return;
    if (this.held != null && this.held !== index) this.release();
    this.held = index;
    this.local = local;
    this.nodes[index * PPN + NODE_FIXED] = 1;
    this.moveHeld(x, y);
  }

  /** Move the held node (the pointer moved). */
  moveHeld(x: number, y: number): void {
    if (this.held == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const j = this.held * PPN;
    this.nodes[j + NODE_X] = x;
    this.nodes[j + NODE_Y] = y;
  }

  /** Let go of the dragged node (it stays pinned only if it was at the start). */
  release(): void {
    if (this.held == null) return;
    this.nodes[this.held * PPN + NODE_FIXED] =
      this.pinned[this.held] === 1 ? 1 : 0;
    this.held = null;
  }

  positions(): Float32Array {
    const xy = new Float32Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      xy[i * 2] = this.nodes[i * PPN + NODE_X];
      xy[i * 2 + 1] = this.nodes[i * PPN + NODE_Y];
    }
    return xy;
  }

  /** Diagonal of the layout's bounding box (the scale "settled" is judged on). */
  extent(): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = this.nodes[i * PPN + NODE_X];
      const y = this.nodes[i * PPN + NODE_Y];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return Math.hypot(maxX - minX, maxY - minY) || 1;
  }
}
