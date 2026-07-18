// Main-process client for the query worker thread. Owns the worker lifecycle
// (lazy spawn, respawn after a crash, terminate on quit) and falls back to
// executing on the main thread when the worker cannot be spawned at all, so
// query behavior degrades gracefully instead of breaking.
import { Worker } from "node:worker_threads";
import { QueryExecutor, type QueryRequest } from "./queryExec.js";
import type {
  WorkerMessage,
  WorkerPayload,
  WorkerReply,
} from "../queryWorker.js";
import type {
  FileRow,
  HistoryPage,
  SearchResult,
  WorkspaceStats,
} from "./types.js";
import { scopedLog } from "./logger.js";

const log = scopedLog("queryWorker");

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

// After this many consecutive crashes the worker is abandoned for the rest of
// the run and queries execute on the main thread. Guards against a worker that
// spawns but dies on every request (e.g. a packaging/module-resolution issue),
// which would otherwise respawn-and-fail forever.
const MAX_CONSECUTIVE_CRASHES = 3;

export class QueryWorkerClient {
  private worker: Worker | null = null;
  /** Set after a spawn failure or repeated crashes: stop retrying, use the fallback. */
  private workerUnavailable = false;
  private disposed = false;
  private crashes = 0;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  /** Main-thread executor used only when the worker cannot run. */
  private readonly fallback = new QueryExecutor();

  constructor(private readonly workerPath: string) {}

  private ensureWorker(): Worker | null {
    if (this.disposed || this.workerUnavailable) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(this.workerPath);
      worker.unref(); // never keep the app alive on its own
      worker.on("message", (reply: WorkerReply) => {
        // A round-trip proves the worker is functional; reset the crash streak.
        this.crashes = 0;
        const p = this.pending.get(reply.id);
        if (!p) return;
        this.pending.delete(reply.id);
        if (reply.ok) p.resolve(reply.result);
        else p.reject(new Error(reply.error));
      });
      const drop = (err: Error) => {
        // Reject everything in flight and let the next request respawn —
        // unless the worker keeps dying, in which case give up on it.
        if (this.worker === worker) this.worker = null;
        if (!this.disposed && ++this.crashes >= MAX_CONSECUTIVE_CRASHES) {
          this.workerUnavailable = true;
          log.warn(
            `query worker crashed ${this.crashes} times; falling back to the main thread`,
          );
        }
        for (const [id, p] of this.pending) {
          this.pending.delete(id);
          p.reject(err);
        }
      };
      worker.on("error", (err) => {
        log.warn("query worker crashed:", err);
        drop(err instanceof Error ? err : new Error(String(err)));
      });
      worker.on("exit", (code) => {
        drop(new Error(`query worker exited (code ${code})`));
      });
      this.worker = worker;
      return worker;
    } catch (e) {
      // Spawn failure (e.g. worker bundle missing): permanent for this run.
      log.warn("query worker could not be spawned; using main thread:", e);
      this.workerUnavailable = true;
      return null;
    }
  }

  private send(msg: WorkerPayload): Promise<unknown> {
    const worker = this.ensureWorker();
    if (!worker) {
      // Main-thread fallback: same executor logic, synchronous.
      switch (msg.type) {
        case "query":
          return Promise.resolve(this.fallback.run(msg.req));
        case "closeWorkspace":
          this.fallback.closeWorkspace(msg.wsId);
          return Promise.resolve(undefined);
        case "closeAll":
          this.fallback.closeAll();
          return Promise.resolve(undefined);
      }
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id } satisfies WorkerMessage);
    });
  }

  run<T extends SearchResult | FileRow[] | HistoryPage | WorkspaceStats>(
    req: QueryRequest,
  ): Promise<T> {
    return this.send({ type: "query", req }) as Promise<T>;
  }

  /** Close a workspace's DB handle (worker and fallback) before its data
   *  directory is deleted — an open handle blocks removal on Windows. */
  async closeWorkspace(wsId: string): Promise<void> {
    this.fallback.closeWorkspace(wsId);
    if (!this.worker) return;
    try {
      await this.send({ type: "closeWorkspace", wsId });
    } catch (e) {
      // A crashed worker holds no handles, so removal can proceed.
      log.warn(`closeWorkspace(${wsId}) failed:`, e);
    }
  }

  /** Shut down: close handles and terminate the worker. Safe to call twice. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.fallback.closeAll();
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}
