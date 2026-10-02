// The force simulation: the WebAssembly engine against d3-force (the fallback
// and the reference), and the alpha schedule around them.
import { describe, expect, it } from "vitest";
import { d3Engine, wasmEngine, type ForceEngine } from "../sim/engine";
import {
  ALPHA_MIN,
  DEFAULT_PHYSICS,
  REHEAT_ALPHA,
  chargeOf,
  type Physics,
} from "../sim/physics";
import { Simulation } from "../sim/simulation";

/** A skewed file–tag graph like a real library's, from a fixed seed. */
function library(files: number, tags: number) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const xy = new Float32Array((files + tags) * 2);
  for (let i = 0; i < xy.length; i++) xy[i] = (random() - 0.5) * 3000;
  const links: number[] = [];
  for (let f = 0; f < files; f++) {
    const k = 1 + Math.floor(random() * 4);
    for (let j = 0; j < k; j++)
      links.push(f, files + Math.floor(tags * random() ** 3));
  }
  return { xy, links: Uint32Array.from(links) };
}

function load(
  engine: ForceEngine,
  g: { xy: Float32Array; links: Uint32Array },
) {
  engine.load(g.xy.slice(), g.links.slice());
}

describe("the WebAssembly engine", () => {
  it("matches d3-force bit for bit", () => {
    const g = library(400, 20);
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
    let alpha = 1;
    for (let t = 0; t < 60; t++) {
      alpha *= 0.98;
      const physics = t < 30 ? DEFAULT_PHYSICS : custom;
      wasm.tick(alpha, physics);
      d3.tick(alpha, physics);
      if (t === 10) {
        wasm.pin(3, 12.5, -40);
        d3.pin(3, 12.5, -40);
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
    for (const g of [library(300, 15), library(50, 5)]) {
      load(wasm, g);
      load(d3, g);
      wasm.pin(0, 1, 2);
      d3.pin(0, 1, 2);
      for (let t = 0; t < 20; t++) {
        wasm.tick(0.5, DEFAULT_PHYSICS);
        d3.tick(0.5, DEFAULT_PHYSICS);
      }
      const p = wasm.positions();
      expect(p.length).toBe(g.xy.length);
      expect([p[0], p[1]]).toEqual([1, 2]);
      expect(Array.from(p)).toEqual(Array.from(d3.positions()));
    }
  });

  it("copes with a graph without links, and with nothing at all", () => {
    const wasm = wasmEngine();
    wasm.load(new Float32Array([0, 0, 0, 0, 5, 5]), new Uint32Array(0));
    wasm.tick(1, DEFAULT_PHYSICS);
    const p = wasm.positions();
    expect(p.every(Number.isFinite)).toBe(true);
    // Coincident nodes are pushed apart.
    expect([p[0], p[1]]).not.toEqual([p[2], p[3]]);
    wasm.load(new Float32Array(0), new Uint32Array(0));
    wasm.tick(1, DEFAULT_PHYSICS);
    expect(wasm.positions().length).toBe(0);
  });
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
