// The graph view's force simulation, off the main thread. Ticks at 60 Hz
// while the simulation is warm, posting each tick's positions back; goes
// quiet (and says so) once it has cooled down. Runs the WebAssembly engine,
// or d3-force where WebAssembly cannot start.
import { d3Engine, wasmEngine, type ForceEngine } from "./engine";
import { REHEAT_ALPHA, TICK_MS } from "./physics";
import type { SimRequest, SimResponse } from "./protocol";
import { Simulation } from "./simulation";

function createEngine(): ForceEngine {
  try {
    return wasmEngine();
  } catch (e) {
    console.warn(
      "graph simulation: WebAssembly unavailable, using d3-force",
      e,
    );
    return d3Engine();
  }
}

const sim = new Simulation(createEngine());
let gen = 0;
let size = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let idle = true;

function post(msg: SimResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function loop(): void {
  timer = null;
  if (!sim.active || size === 0) {
    if (!idle) post({ type: "idle", gen });
    idle = true;
    return;
  }
  // Scheduled first, so ticks stay a frame apart whatever one costs.
  schedule();
  sim.step();
  const xy = sim.engine.positions();
  post({ type: "positions", gen, xy }, [xy.buffer]);
}

function schedule(): void {
  if (timer == null && sim.active) {
    idle = false;
    timer = setTimeout(loop, TICK_MS);
  }
}

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case "load": {
      const n = msg.xy.length / 2;
      // Indices past the nodes would read and write outside the arrays in
      // the WebAssembly memory (it is built without bounds checks).
      if (msg.links.some((i) => i >= n)) {
        console.error("graph simulation: a link points past the nodes");
        return;
      }
      gen = msg.gen;
      size = n;
      sim.engine.load(msg.xy, msg.links);
      let pinned = false;
      for (const p of msg.pins)
        if (p.index < size) {
          sim.engine.pin(p.index, p.x, p.y);
          pinned = true;
        }
      // A drag keeps the graph warm; one whose node did not come along
      // must not (its release would name a node this graph lacks).
      sim.alphaTarget = pinned ? REHEAT_ALPHA : 0;
      sim.raise(msg.alpha);
      break;
    }
    case "physics":
      sim.physics = msg.physics;
      break;
    case "pin":
      if (msg.gen !== gen || msg.index >= size) break;
      if (msg.x == null || msg.y == null) sim.engine.unpin(msg.index);
      else if (Number.isFinite(msg.x) && Number.isFinite(msg.y))
        sim.engine.pin(msg.index, msg.x, msg.y);
      break;
    case "heat":
      if (msg.alpha != null) sim.raise(msg.alpha);
      if (msg.alphaTarget != null) sim.alphaTarget = msg.alphaTarget;
      break;
    case "stop":
      if (timer != null) clearTimeout(timer);
      timer = null;
      size = 0;
      return;
  }
  schedule();
};
