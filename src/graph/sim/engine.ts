// One tick of the force simulation, over a graph given as positions and link
// index pairs. Two engines compute the same thing: the WebAssembly one
// (assembly/forces.ts, about three times faster) and d3-force itself, used
// when WebAssembly cannot start. Their results match bit for bit.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
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

export interface ForceEngine {
  /** Replace the graph: node i starts at (xy[2i], xy[2i+1]) at rest, and
   *  link k joins nodes links[2k] and links[2k+1]. Pins are dropped. */
  load(xy: Float32Array, links: Uint32Array): void;
  /** Hold node i at (x, y) until unpinned. */
  pin(i: number, x: number, y: number): void;
  unpin(i: number): void;
  tick(alpha: number, physics: Physics): void;
  /** The positions, in a fresh array (so it can be transferred). */
  positions(): Float32Array;
}

interface ForcesExports {
  memory: WebAssembly.Memory;
  setup(nodes: number, links: number): void;
  prepareLinks(): void;
  xPtr(): number;
  yPtr(): number;
  fxPtr(): number;
  fyPtr(): number;
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
  // Views are made per call: a tick may grow the memory, which detaches them.
  const f64 = (ptr: number) => new Float64Array(w.memory.buffer, ptr, n);
  return {
    load(xy, links) {
      n = xy.length / 2;
      const m = links.length / 2;
      w.setup(n, m);
      const x = f64(w.xPtr());
      const y = f64(w.yPtr());
      for (let i = 0; i < n; i++) {
        x[i] = xy[i * 2];
        y[i] = xy[i * 2 + 1];
      }
      const s = new Int32Array(w.memory.buffer, w.sourcePtr(), m);
      const t = new Int32Array(w.memory.buffer, w.targetPtr(), m);
      for (let k = 0; k < m; k++) {
        s[k] = links[k * 2];
        t[k] = links[k * 2 + 1];
      }
      w.prepareLinks();
    },
    pin(i, x, y) {
      f64(w.fxPtr())[i] = x;
      f64(w.fyPtr())[i] = y;
    },
    unpin(i) {
      f64(w.fxPtr())[i] = NaN;
      f64(w.fyPtr())[i] = NaN;
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
      const x = f64(w.xPtr());
      const y = f64(w.yPtr());
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        out[i * 2] = x[i];
        out[i * 2 + 1] = y[i];
      }
      return out;
    },
  };
}

type Node = SimulationNodeDatum;
type Link = SimulationLinkDatum<Node>;

/** d3-force with the same forces, stepped at an alpha the caller sets. */
export function d3Engine(): ForceEngine {
  let nodes: Node[] = [];
  let sim: Simulation<Node, Link> | null = null;
  let forces: {
    x: ForceX<Node>;
    y: ForceY<Node>;
    link: ForceLink<Node, Link>;
    charge: ForceManyBody<Node>;
    /** d3's default strength of each link (1 / the smaller degree). */
    defaults: number[];
  } | null = null;
  let applied: Physics | null = null;
  return {
    load(xy, links) {
      nodes = [];
      for (let i = 0; i < xy.length / 2; i++)
        nodes.push({ index: i, x: xy[i * 2], y: xy[i * 2 + 1], vx: 0, vy: 0 });
      const list: Link[] = [];
      for (let k = 0; k < links.length; k += 2)
        list.push({ source: links[k], target: links[k + 1] });
      const x = forceX<Node>(0);
      const y = forceY<Node>(0);
      const link = forceLink<Node, Link>(list);
      const charge = forceManyBody<Node>()
        .theta(THETA)
        .distanceMin(DISTANCE_MIN);
      sim = forceSimulation(nodes)
        .stop()
        .alphaDecay(0)
        .velocityDecay(1 - VELOCITY_DECAY)
        .force("x", x)
        .force("y", y)
        .force("link", link)
        .force("charge", charge)
        .force(
          "collide",
          forceCollide<Node>(COLLIDE_RADIUS).strength(COLLIDE_STRENGTH),
        );
      // Read once the link force knows the degrees (it did on being added).
      const base = link.strength();
      const defaults = list.map((l, i) => +base(l, i, list));
      forces = { x, y, link, charge, defaults };
      applied = null;
    },
    pin(i, x, y) {
      nodes[i].fx = x;
      nodes[i].fy = y;
    },
    unpin(i) {
      nodes[i].fx = null;
      nodes[i].fy = null;
    },
    tick(alpha, p) {
      if (!sim || !forces) return;
      if (applied !== p) {
        applied = p;
        const { defaults } = forces;
        forces.x.strength(p.centerStrength);
        forces.y.strength(p.centerStrength);
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
      const out = new Float32Array(nodes.length * 2);
      nodes.forEach((d, i) => {
        out[i * 2] = d.x ?? 0;
        out[i * 2 + 1] = d.y ?? 0;
      });
      return out;
    },
  };
}
