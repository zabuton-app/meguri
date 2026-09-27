// Drives the layout worker: one worker for the view's lifetime, one run at a
// time (a new run supersedes the old), positions handed over at most once per
// animation frame.
import log from "@/lib/logger";
import type {
  LayoutRequest,
  LayoutResponse,
  LayoutStart,
} from "./layoutProtocol";

export type LayoutInput = Omit<LayoutStart, "type" | "runId">;

export interface LayoutCallbacks {
  onPositions: (xy: Float32Array) => void;
  onDone: () => void;
}

export class LayoutClient {
  private worker: Worker | null = null;
  private runId = 0;
  private callbacks: LayoutCallbacks | null = null;
  private pending: Float32Array | null = null;
  private frame = 0;
  private running = false;
  private listeners = new Set<() => void>();

  /** For useSyncExternalStore: whether a run is in progress. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isRunning = (): boolean => this.running;

  private setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    for (const l of this.listeners) l();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      log.warn("graph layout worker unavailable:", e);
      return null;
    }
    this.worker.onmessage = (e: MessageEvent<LayoutResponse>) =>
      this.receive(e.data);
    this.worker.onerror = (e) => {
      log.warn("graph layout worker failed:", e.message);
      this.finish(this.runId);
    };
    return this.worker;
  }

  /** Start a run; the previous one (if any) is abandoned without its onDone. */
  run(input: LayoutInput, callbacks: LayoutCallbacks): void {
    const worker = this.ensureWorker();
    this.runId += 1;
    this.callbacks = callbacks;
    this.pending = null;
    this.setRunning(true);
    if (!worker) {
      // No worker (tests, a broken build): keep the placed positions.
      const runId = this.runId;
      queueMicrotask(() => this.finish(runId));
      return;
    }
    const req: LayoutRequest = { type: "start", runId: this.runId, ...input };
    worker.postMessage(req, [
      input.xy.buffer,
      input.fixed.buffer,
      input.ea.buffer,
      input.eb.buffer,
      input.weight.buffer,
    ]);
  }

  stop(): void {
    this.runId += 1;
    this.callbacks = null;
    this.pending = null;
    this.setRunning(false);
    this.worker?.postMessage({ type: "stop" } satisfies LayoutRequest);
  }

  dispose(): void {
    this.stop();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.worker?.terminate();
    this.worker = null;
  }

  private receive(msg: LayoutResponse): void {
    if (msg.runId !== this.runId) return;
    if (msg.type === "positions") {
      this.pending = msg.xy;
      if (!this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          const xy = this.pending;
          this.pending = null;
          if (xy) this.callbacks?.onPositions(xy);
        });
      }
      return;
    }
    this.finish(msg.runId);
  }

  private finish(runId: number): void {
    if (runId !== this.runId) return;
    // Deliver the last positions before reporting the end.
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const cb = this.callbacks;
    const xy = this.pending;
    this.pending = null;
    this.callbacks = null;
    this.setRunning(false);
    if (xy) cb?.onPositions(xy);
    cb?.onDone();
  }
}
