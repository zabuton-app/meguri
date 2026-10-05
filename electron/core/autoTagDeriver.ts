// Where the auto-tagging engine is evaluated. The database side (autoTag.ts)
// only knows the DeriveAutoTags shape; the app hands it the worker-backed one,
// so a rule that never finishes costs a killed thread instead of a frozen app.
import { Worker } from "node:worker_threads";
import type {
  AutoTagWorkerReply,
  AutoTagWorkerRequest,
} from "../autoTagWorker.js";
import { scopedLog } from "./logger.js";
import {
  compileEngine,
  tagsForName,
  type KeywordEntry,
  type TagRule,
} from "../../shared/autoTag.js";

const log = scopedLog("autoTag");

export interface AutoTagEngine {
  rules: readonly TagRule[];
  keywords: readonly KeywordEntry[];
}

/** Tags for each file name, in the same order. */
export type DeriveAutoTags = (
  engine: AutoTagEngine,
  names: readonly string[],
) => Promise<string[][]>;

/** A chunk did not come back in time: some rule does not terminate on some name. */
export class AutoTagTimeoutError extends Error {
  constructor() {
    super("auto-tagging rules timed out");
    this.name = "AutoTagTimeoutError";
  }
}

/** The worker could not run, so nothing was evaluated. */
export class AutoTagUnavailableError extends Error {
  constructor(cause: unknown) {
    super("auto-tagging worker is unavailable", { cause });
    this.name = "AutoTagUnavailableError";
  }
}

/** Evaluate on the calling thread. Nothing can interrupt it — tests only. */
export const deriveAutoTagsInProcess: DeriveAutoTags = (engine, names) => {
  const compiled = compileEngine(engine);
  return Promise.resolve(names.map((name) => tagsForName(compiled, name)));
};

/**
 * Budget for one chunk. A chunk is a few hundred short strings, so a healthy
 * engine answers in milliseconds; only runaway backtracking gets near this.
 */
export const AUTO_TAG_CHUNK_TIMEOUT_MS = 5_000;

interface Pending {
  resolve: (tags: string[][]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class AutoTagWorkerClient {
  private worker: Worker | null = null;
  private disposed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly workerPath: string,
    private readonly timeoutMs = AUTO_TAG_CHUNK_TIMEOUT_MS,
  ) {}

  /**
   * Bound, so it can be handed around as a plain DeriveAutoTags.
   *
   * Fails closed: when the worker cannot answer, nothing is evaluated here in
   * its place. Running an arbitrary regular expression on the main thread is
   * the one thing this class exists to prevent, and a worker that will not
   * load is exactly when nobody would notice it happening.
   */
  readonly derive: DeriveAutoTags = async (engine, names) => {
    if (names.length === 0) return [];
    if (this.disposed) throw new AutoTagUnavailableError("disposed");
    try {
      return await this.request(engine, names);
    } catch (err) {
      if (err instanceof AutoTagTimeoutError) throw err;
      log.warn("auto-tag worker failed:", err);
      throw new AutoTagUnavailableError(err);
    }
  };

  private request(
    engine: AutoTagEngine,
    names: readonly string[],
  ): Promise<string[][]> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // The thread is stuck inside a regular expression; terminating it is
        // the only way out, and it takes every request in flight with it.
        this.dropWorker(worker, new AutoTagTimeoutError());
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({
        id,
        rules: [...engine.rules],
        keywords: [...engine.keywords],
        names: [...names],
      } satisfies AutoTagWorkerRequest);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath);
    worker.unref(); // never keep the app alive on its own
    worker.on("message", (reply: AutoTagWorkerReply) => {
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      clearTimeout(p.timer);
      if (reply.ok) p.resolve(reply.tags);
      else p.reject(new Error(reply.error));
    });
    worker.on("error", (err) => this.dropWorker(worker, err));
    worker.on("exit", () =>
      this.dropWorker(worker, new Error("auto-tag worker exited")),
    );
    this.worker = worker;
    return worker;
  }

  /** Terminate `worker` and fail everything waiting on it. Idempotent. */
  private dropWorker(worker: Worker, reason: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    void worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) this.dropWorker(this.worker, new Error("disposed"));
  }
}
