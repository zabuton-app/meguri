// ForceAtlas2 off the main thread (the engine is layoutEngine.ts). A run is
// laid out in slices of about a frame, and each slice's positions are posted
// back, so the view moves smoothly and a message (a drag, a newer start, a
// stop) never waits long for the current slice. While the user holds a node
// the run goes on with that node pinned under the pointer, so its neighbours
// follow live; once released it settles and ends.
import { LayoutEngine } from "./layoutEngine";
import type {
  LayoutRequest,
  LayoutResponse,
  LayoutStart,
} from "./layoutProtocol";

/** Time one slice of iterations may take (ms): about one frame. */
const SLICE_MS = 12;
/** Mean per-node move per iteration, relative to the layout's extent, below
 *  which the layout has settled. */
const SETTLED = 0.000025;

let current = 0;
let engine: LayoutEngine | null = null;
/** Wakes a held run that went idle (the pointer stopped) on the next message. */
let wake: (() => void) | null = null;

function post(msg: LayoutResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function nextMessage(): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
  });
}

async function run(req: LayoutStart): Promise<void> {
  const e = new LayoutEngine(req);
  engine = e;
  if (req.hold) e.hold(req.hold.index, req.hold.x, req.hold.y, req.hold.local);

  let iterations = 0;
  let started = performance.now();
  while (current === req.runId) {
    const holding = e.holding;
    const sliceStart = performance.now();
    let moved = 0;
    let steps = 0;
    do {
      moved += e.step(1);
      steps++;
    } while (performance.now() - sliceStart < SLICE_MS);
    const xy = e.positions();
    let finite = true;
    for (let i = 0; i < xy.length; i++)
      if (!Number.isFinite(xy[i])) {
        finite = false;
        break;
      }
    if (!finite) throw new Error("layout diverged");
    post({ type: "positions", runId: req.runId, xy }, [xy.buffer]);

    const settled =
      moved / steps / Math.max(1, e.freeCount) / e.extent() < SETTLED;
    if (holding) {
      // Held, the run never ends by itself; time and iterations start over
      // from the moment the node is let go. Once nothing moves (the pointer
      // rests) it waits for the next message instead of spinning.
      iterations = 0;
      started = performance.now();
      if (settled) await nextMessage();
    } else {
      iterations += steps;
      if (
        settled ||
        iterations >= req.maxIterations ||
        performance.now() - started > req.budgetMs
      )
        break;
    }
    // Yield so drag / release / stop / a newer start can land between slices.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (current === req.runId) {
    post({ type: "done", runId: req.runId, iterations });
    engine = null;
  }
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const req = e.data;
  const w = wake;
  wake = null;
  switch (req.type) {
    case "stop":
      current = 0;
      engine = null;
      break;
    case "drag":
      if (req.runId === current) engine?.moveHeld(req.x, req.y);
      break;
    case "release":
      if (req.runId === current) engine?.release();
      break;
    case "start":
      current = req.runId;
      // A failed run still ends, so the view does not wait on it forever.
      run(req).catch((err: unknown) => {
        console.error("graph layout failed:", err);
        if (current === req.runId) {
          post({ type: "done", runId: req.runId, iterations: 0 });
          engine = null;
        }
      });
  }
  w?.();
};
