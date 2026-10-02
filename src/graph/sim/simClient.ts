// Drives the simulation worker: one worker for the view's lifetime, the graph
// it simulates replaced with load(), positions handed over at most once per
// animation frame. Without a worker (tests, a broken build) nodes keep the
// positions they were loaded with and the simulation reports idle at once.
import log from "@/lib/logger";
import { REHEAT_ALPHA, type Physics } from "./physics";
import type { SimLoad, SimRequest, SimResponse } from "./protocol";

export interface SimCallbacks {
  /** New positions (dims per node) for the graph of generation `gen`, in
   *  load() order. */
  onPositions: (pos: Float32Array, gen: number) => void;
  /** The simulation of generation `gen` cooled down. */
  onIdle: (gen: number) => void;
}

export class SimClient {
  private worker: Worker | null = null;
  private failed = false;
  private gen = 0;
  private pending: Float32Array | null = null;
  private frame = 0;
  private callbacks: SimCallbacks | null = null;

  setCallbacks(callbacks: SimCallbacks | null): void {
    this.callbacks = callbacks;
  }

  /** The generation of the last load(). */
  get generation(): number {
    return this.gen;
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.failed) return this.worker;
    try {
      this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      this.failed = true;
      log.warn("graph simulation worker unavailable:", e);
      return null;
    }
    this.worker.onmessage = (e: MessageEvent<SimResponse>) =>
      this.receive(e.data);
    this.worker.onerror = (e) => {
      log.warn("graph simulation failed:", e.message);
      // A dead worker would swallow every later load; carry on without one
      // (nodes keep the positions they are loaded with).
      this.worker?.terminate();
      this.worker = null;
      this.failed = true;
      this.callbacks?.onIdle(this.gen);
    };
    return this.worker;
  }

  private post(req: SimRequest, transfer: Transferable[] = []): boolean {
    const worker = this.ensureWorker();
    worker?.postMessage(req, transfer);
    return !!worker;
  }

  /** Simulate a new graph (see SimLoad); returns its generation. */
  load(input: Omit<SimLoad, "type" | "gen">): number {
    const gen = ++this.gen;
    this.pending = null;
    if (
      !this.post({ type: "load", gen, ...input }, [
        input.pos.buffer,
        input.links.buffer,
      ])
    )
      queueMicrotask(() => {
        if (gen === this.gen) this.callbacks?.onIdle(gen);
      });
    return gen;
  }

  /** New forces; the graph warms up to show their effect. */
  setPhysics(physics: Physics): void {
    this.post({ type: "physics", physics });
    this.post({ type: "heat", alpha: REHEAT_ALPHA });
  }

  /** Warm the simulation back up (only ever raises). */
  reheat(alpha = REHEAT_ALPHA): void {
    this.post({ type: "heat", alpha });
  }

  /** Hold node `index` of the current graph at `at` (dims coordinates) and
   *  keep it warm, as a drag does in Obsidian: every move reheats. */
  drag(index: number, at: number[]): void {
    this.post({ type: "pin", gen: this.gen, index, at });
    this.post({ type: "heat", alpha: REHEAT_ALPHA, alphaTarget: REHEAT_ALPHA });
  }

  /** Let go of node `index` (null: it is no longer in the graph): the graph
   *  cools down from here. */
  release(index: number | null): void {
    if (index != null) this.post({ type: "pin", gen: this.gen, index });
    this.post({ type: "heat", alphaTarget: 0 });
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = null;
    this.callbacks = null;
    this.worker?.postMessage({ type: "stop" } satisfies SimRequest);
    this.worker?.terminate();
    this.worker = null;
  }

  private receive(msg: SimResponse): void {
    if (msg.gen !== this.gen) return;
    if (msg.type === "idle") {
      this.flush();
      this.callbacks?.onIdle(msg.gen);
      return;
    }
    this.pending = msg.pos;
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.flush();
      });
  }

  private flush(): void {
    const pos = this.pending;
    this.pending = null;
    if (pos) this.callbacks?.onPositions(pos, this.gen);
  }
}
