// ForceAtlas2 off the main thread. The graph is rebuilt here from index
// arrays, laid out in small chunks, and each chunk's positions are posted
// back so the view settles visibly while staying responsive. A new "start"
// or a "stop" ends the current run between chunks.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type {
  LayoutRequest,
  LayoutResponse,
  LayoutStart,
} from "./layoutProtocol";

const CHUNK = 20;
/** Mean per-node move, relative to the layout's extent, below which it has settled. */
const SETTLED = 0.0005;

let current = 0;

function post(msg: LayoutResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

async function run(req: LayoutStart): Promise<void> {
  const n = req.fixed.length;
  // Settling is judged on the nodes that can move: counting pinned ones
  // would call a partial layout done while its new nodes still drift.
  let free = 0;
  for (let i = 0; i < n; i++) if (req.fixed[i] !== 1) free++;
  const graph = new Graph({ type: "undirected", multi: false });
  for (let i = 0; i < n; i++) {
    graph.addNode(i, {
      x: req.xy[i * 2],
      y: req.xy[i * 2 + 1],
      fixed: req.fixed[i] === 1,
    });
  }
  for (let i = 0; i < req.ea.length; i++) {
    const a = req.ea[i];
    const b = req.eb[i];
    if (a === b || graph.hasEdge(a, b)) continue;
    graph.addEdge(a, b, { weight: req.weight[i] });
  }
  const settings = {
    ...forceAtlas2.inferSettings(graph),
    linLogMode: true,
    edgeWeightInfluence: 1,
    barnesHutOptimize: n > 1_000,
  };

  const started = performance.now();
  let prev = Float32Array.from(req.xy);
  let iterations = 0;
  while (iterations < req.maxIterations) {
    forceAtlas2.assign(graph, {
      iterations: CHUNK,
      settings,
      getEdgeWeight: "weight",
    });
    iterations += CHUNK;

    const xy = new Float32Array(n * 2);
    let moved = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    graph.forEachNode((key, attrs) => {
      const i = Number(key);
      const x = attrs.x as number;
      const y = attrs.y as number;
      xy[i * 2] = x;
      xy[i * 2 + 1] = y;
      moved += Math.hypot(x - prev[i * 2], y - prev[i * 2 + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    prev = Float32Array.from(xy);
    post({ type: "positions", runId: req.runId, xy }, [xy.buffer]);

    const extent = Math.hypot(maxX - minX, maxY - minY) || 1;
    if (moved / Math.max(1, free) / extent < SETTLED) break;
    if (performance.now() - started > req.budgetMs) break;
    // Yield so a "stop" or a newer "start" can land between chunks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (current !== req.runId) return;
  }
  if (current === req.runId)
    post({ type: "done", runId: req.runId, iterations });
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const req = e.data;
  if (req.type === "stop") {
    current = 0;
    return;
  }
  current = req.runId;
  // A failed run still ends, so the view does not wait on it forever.
  run(req).catch((err: unknown) => {
    console.error("graph layout failed:", err);
    if (current === req.runId)
      post({ type: "done", runId: req.runId, iterations: 0 });
  });
};
