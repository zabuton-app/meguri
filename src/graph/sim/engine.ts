// One tick of the force simulation, over a graph given as positions (2 or 3
// per node) and link index pairs. Two engines compute the same thing: the
// WebAssembly one (assembly/forces.ts, three to four times faster) and
// d3-force-3d itself (d3-force in 2D), used when WebAssembly cannot start.
// Their results match bit for bit.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type LinkForce,
  type ManyBodyForce,
  type PositionForce,
  type SimLink,
  type SimNode,
  type Simulation,
} from "d3-force-3d";
import { FORCES_WASM_BASE64 } from "./forcesWasm";
import {
  COLLIDE_RADIUS,
  COLLIDE_STRENGTH,
  DISTANCE_MIN,
  THETA,
  VELOCITY_DECAY,
  chargeOf,
  type Physics,
} from "./physics";

/** Dimensions the simulation runs in. */
export type Dims = 2 | 3;

export interface ForceEngine {
  /** Replace the graph: node i starts at pos[i·dims ..] at rest, and link k
   *  joins nodes links[2k] and links[2k+1]. Pins are dropped. */
  load(pos: Float32Array, links: Uint32Array, dims: Dims): void;
  /** Hold node i at `at` (dims coordinates) until unpinned. */
  pin(i: number, at: readonly number[]): void;
  unpin(i: number): void;
  tick(alpha: number, physics: Physics): void;
  /** The positions, dims per node, in a fresh array (so it can be transferred). */
  positions(): Float32Array;
}

interface ForcesExports {
  memory: WebAssembly.Memory;
  setup(nodes: number, links: number, dims: number): void;
  prepareLinks(): void;
  xPtr(): number;
  yPtr(): number;
  zPtr(): number;
  fxPtr(): number;
  fyPtr(): number;
  fzPtr(): number;
  sourcePtr(): number;
  targetPtr(): number;
  tick(
    alpha: number,
    center: number,
    linkStrength: number,
    linkDistance: number,
    charge: number,
    theta: number,
    distanceMin: number,
    collideRadius: number,
    collideStrength: number,
    velocityDecay: number,
  ): void;
}

function wasmBytes(): Uint8Array<ArrayBuffer> {
  const text = atob(FORCES_WASM_BASE64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** The WebAssembly engine; throws where WebAssembly is unavailable. */
export function wasmEngine(): ForceEngine {
  const module = new WebAssembly.Module(wasmBytes());
  const w = new WebAssembly.Instance(module, {
    env: {
      abort: () => {
        throw new Error("graph simulation aborted");
      },
    },
  }).exports as unknown as ForcesExports;
  let n = 0;
  let dims: Dims = 2;
  // Views are made per call: a tick may grow the memory, which detaches them.
  const f64 = (ptr: number) => new Float64Array(w.memory.buffer, ptr, n);
  const coords = () => [w.xPtr(), w.yPtr(), w.zPtr()].slice(0, dims);
  const fixed = () => [w.fxPtr(), w.fyPtr(), w.fzPtr()].slice(0, dims);
  return {
    load(pos, links, d) {
      dims = d;
      n = pos.length / dims;
      const m = links.length / 2;
      w.setup(n, m, dims);
      coords().forEach((ptr, c) => {
        const v = f64(ptr);
        for (let i = 0; i < n; i++) v[i] = pos[i * dims + c];
      });
      const s = new Int32Array(w.memory.buffer, w.sourcePtr(), m);
      const t = new Int32Array(w.memory.buffer, w.targetPtr(), m);
      for (let k = 0; k < m; k++) {
        s[k] = links[k * 2];
        t[k] = links[k * 2 + 1];
      }
      w.prepareLinks();
    },
    pin(i, at) {
      fixed().forEach((ptr, c) => (f64(ptr)[i] = at[c]));
    },
    unpin(i) {
      fixed().forEach((ptr) => (f64(ptr)[i] = NaN));
    },
    tick(alpha, p) {
      w.tick(
        alpha,
        p.centerStrength,
        p.linkStrength,
        p.linkDistance,
        chargeOf(p),
        THETA,
        DISTANCE_MIN,
        COLLIDE_RADIUS,
        COLLIDE_STRENGTH,
        VELOCITY_DECAY,
      );
    },
    positions() {
      const out = new Float32Array(n * dims);
      coords().forEach((ptr, c) => {
        const v = f64(ptr);
        for (let i = 0; i < n; i++) out[i * dims + c] = v[i];
      });
      return out;
    },
  };
}

const AXES = ["x", "y", "z"] as const;
const FIXED = ["fx", "fy", "fz"] as const;

/** d3-force-3d with the same forces, stepped at an alpha the caller sets. */
export function d3Engine(): ForceEngine {
  let nodes: SimNode[] = [];
  let dims: Dims = 2;
  let sim: Simulation | null = null;
  let forces: {
    position: PositionForce[];
    link: LinkForce;
    charge: ManyBodyForce;
    /** d3's default strength of each link (1 / the smaller degree). */
    defaults: number[];
  } | null = null;
  let applied: Physics | null = null;
  return {
    load(pos, links, d) {
      dims = d;
      nodes = [];
      for (let i = 0; i < pos.length / dims; i++) {
        const node: SimNode = { index: i, vx: 0, vy: 0, vz: 0 };
        for (let c = 0; c < dims; c++) node[AXES[c]] = pos[i * dims + c];
        nodes.push(node);
      }
      const list: SimLink[] = [];
      for (let k = 0; k < links.length; k += 2)
        list.push({ source: links[k], target: links[k + 1] });
      const position = [forceX(0), forceY(0), forceZ(0)].slice(0, dims);
      const link = forceLink(list);
      const charge = forceManyBody().theta(THETA).distanceMin(DISTANCE_MIN);
      sim = forceSimulation(nodes, dims)
        .stop()
        .alphaDecay(0)
        .velocityDecay(1 - VELOCITY_DECAY);
      position.forEach((force, c) => sim?.force(AXES[c], force));
      sim
        .force("link", link)
        .force("charge", charge)
        .force(
          "collide",
          forceCollide(COLLIDE_RADIUS).strength(COLLIDE_STRENGTH),
        );
      // Read once the link force knows the degrees (it did on being added).
      const base = link.strength();
      const defaults = list.map((l, i) => +base(l, i, list));
      forces = { position, link, charge, defaults };
      applied = null;
    },
    pin(i, at) {
      for (let c = 0; c < dims; c++) nodes[i][FIXED[c]] = at[c];
    },
    unpin(i) {
      for (let c = 0; c < dims; c++) nodes[i][FIXED[c]] = null;
    },
    tick(alpha, p) {
      if (!sim || !forces) return;
      if (applied !== p) {
        applied = p;
        const { defaults } = forces;
        for (const force of forces.position) force.strength(p.centerStrength);
        // Obsidian's scaling of the default, multiplied in the order the
        // WebAssembly engine uses so the two stay identical.
        forces.link
          .distance(p.linkDistance)
          .strength((_l, i) => p.linkStrength * defaults[i]);
        forces.charge.strength(chargeOf(p));
      }
      sim.alpha(alpha).tick(1);
    },
    positions() {
      const out = new Float32Array(nodes.length * dims);
      nodes.forEach((d, i) => {
        for (let c = 0; c < dims; c++) out[i * dims + c] = d[AXES[c]] ?? 0;
      });
      return out;
    },
  };
}
