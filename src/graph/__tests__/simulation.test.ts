// The force simulation: the WebAssembly engine against d3-force-3d (the
// fallback and the reference; in 2D it is d3-force), in 2 and 3 dimensions,
// and the alpha schedule around them.
import { describe, expect, it } from "vitest";
import {
  d3Engine,
  wasmEngine,
  type Dims,
  type ForceEngine,
} from "../sim/engine";
import {
  ALPHA_MIN,
  DEFAULT_PHYSICS,
  REHEAT_ALPHA,
  chargeOf,
  type Physics,
} from "../sim/physics";
import { Simulation } from "../sim/simulation";

/** A skewed file–tag graph like a real library's, from a fixed seed. */
function library(files: number, tags: number, dims: Dims = 2) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pos = new Float32Array((files + tags) * dims);
  for (let i = 0; i < pos.length; i++) pos[i] = (random() - 0.5) * 3000;
  const links: number[] = [];
  for (let f = 0; f < files; f++) {
    const k = 1 + Math.floor(random() * 4);
    for (let j = 0; j < k; j++)
      links.push(f, files + Math.floor(tags * random() ** 3));
  }
  return { pos, links: Uint32Array.from(links), dims };
}

function load(
  engine: ForceEngine,
  g: { pos: Float32Array; links: Uint32Array; dims: Dims },
) {
  engine.load(g.pos.slice(), g.links.slice(), g.dims);
}

describe.each([2, 3] as const)("the WebAssembly engine in %dD", (dims) => {
  it("matches d3-force-3d bit for bit", () => {
    const g = library(400, 20, dims);
    const wasm = wasmEngine();
    const d3 = d3Engine();
    load(wasm, g);
    load(d3, g);
    const custom: Physics = {
      centerStrength: 0.37,
      repelStrength: 523,
      linkStrength: 0.7,
      linkDistance: 180,
    };
    const at = [12.5, -40, 7].slice(0, dims);
    let alpha = 1;
    for (let t = 0; t < 60; t++) {
      alpha *= 0.98;
      const physics = t < 30 ? DEFAULT_PHYSICS : custom;
      wasm.tick(alpha, physics);
      d3.tick(alpha, physics);
      if (t === 10) {
        wasm.pin(3, at);
        d3.pin(3, at);
      }
      if (t === 40) {
        wasm.unpin(3);
        d3.unpin(3);
      }
    }
    expect(Array.from(wasm.positions())).toEqual(Array.from(d3.positions()));
  });

  it("starts over on a new graph, and holds a pinned node where it is put", () => {
    const wasm = wasmEngine();
    const d3 = d3Engine();
    const at = [1, 2, 3].slice(0, dims);
    for (const g of [library(300, 15, dims), library(50, 5, dims)]) {
      load(wasm, g);
      load(d3, g);
      wasm.pin(0, at);
      d3.pin(0, at);
      for (let t = 0; t < 20; t++) {
        wasm.tick(0.5, DEFAULT_PHYSICS);
        d3.tick(0.5, DEFAULT_PHYSICS);
      }
      const p = wasm.positions();
      expect(p.length).toBe(g.pos.length);
      expect(Array.from(p.slice(0, dims))).toEqual(at);
      expect(Array.from(p)).toEqual(Array.from(d3.positions()));
    }
  });

  it("matches d3-force-3d on coincident and axis-aligned nodes too", () => {
    // Stacked nodes exercise the trees' coincident chains and every jiggle.
    const pos = new Float32Array(8 * dims);
    for (let i = 4; i < 8; i++) pos[i * dims] = 100 * (i - 3);
    const links = Uint32Array.from([0, 1, 1, 2, 4, 5, 6, 7, 0, 7]);
    const wasm = wasmEngine();
    const d3 = d3Engine();
    wasm.load(pos.slice(), links.slice(), dims);
    d3.load(pos.slice(), links.slice(), dims);
    for (let t = 0; t < 30; t++) {
      wasm.tick(1, DEFAULT_PHYSICS);
      d3.tick(1, DEFAULT_PHYSICS);
    }
    expect(Array.from(wasm.positions())).toEqual(Array.from(d3.positions()));
  });

  it("copes with a graph without links, and with nothing at all", () => {
    const wasm = wasmEngine();
    const pos = new Float32Array(3 * dims);
    pos[2 * dims] = 5;
    wasm.load(pos, new Uint32Array(0), dims);
    wasm.tick(1, DEFAULT_PHYSICS);
    const p = wasm.positions();
    expect(p.every(Number.isFinite)).toBe(true);
    // Coincident nodes are pushed apart.
    expect(Array.from(p.slice(0, dims))).not.toEqual(
      Array.from(p.slice(dims, 2 * dims)),
    );
    wasm.load(new Float32Array(0), new Uint32Array(0), dims);
    wasm.tick(1, DEFAULT_PHYSICS);
    expect(wasm.positions().length).toBe(0);
  });
});

it("switches between 2D and 3D graphs on one engine", () => {
  const wasm = wasmEngine();
  const d3 = d3Engine();
  for (const dims of [3, 2, 3] as const) {
    const g = library(120, 8, dims);
    load(wasm, g);
    load(d3, g);
    for (let t = 0; t < 10; t++) {
      wasm.tick(0.8, DEFAULT_PHYSICS);
      d3.tick(0.8, DEFAULT_PHYSICS);
    }
    expect(Array.from(wasm.positions())).toEqual(Array.from(d3.positions()));
  }
});

describe("the physics", () => {
  it("pushes with at least a repel of 1", () => {
    expect(chargeOf({ ...DEFAULT_PHYSICS, repelStrength: 1000 })).toBe(-1000);
    expect(chargeOf({ ...DEFAULT_PHYSICS, repelStrength: 0 })).toBe(-1);
  });
});

describe("Simulation", () => {
  function counting() {
    let ticks = 0;
    const engine: ForceEngine = {
      load: () => {},
      pin: () => {},
      unpin: () => {},
      tick: () => void ticks++,
      positions: () => new Float32Array(0),
    };
    return { engine, ticks: () => ticks };
  }

  it("cools from 1 to a stop in about 300 ticks", () => {
    const { engine, ticks } = counting();
    const sim = new Simulation(engine);
    while (sim.step());
    expect(ticks()).toBeGreaterThanOrEqual(299);
    expect(ticks()).toBeLessThanOrEqual(301);
    expect(sim.alpha).toBeLessThanOrEqual(ALPHA_MIN);
    expect(sim.step()).toBe(false);
  });

  it("only raises alpha, and stays warm while a target holds it", () => {
    const { engine } = counting();
    const sim = new Simulation(engine);
    sim.alpha = 0.5;
    sim.raise(REHEAT_ALPHA);
    expect(sim.alpha).toBe(0.5);
    sim.alpha = 0;
    sim.raise(REHEAT_ALPHA);
    expect(sim.alpha).toBe(REHEAT_ALPHA);
    sim.alphaTarget = REHEAT_ALPHA;
    for (let i = 0; i < 2000; i++) sim.step();
    expect(sim.active).toBe(true);
    sim.alphaTarget = 0;
    let n = 0;
    while (sim.step()) n++;
    expect(n).toBeGreaterThan(200);
  });
});
