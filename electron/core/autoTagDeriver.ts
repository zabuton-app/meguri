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
  AUTO_TAG_CHUNK_TIMEOUT_MS,
  compileEngine,
  ruleBehaviorKey,
  tagsForName,
  type FolderRule,
  type KeywordEntry,
  type TagRule,
} from "../../shared/autoTag.js";

const log = scopedLog("autoTag");

export interface AutoTagEngine {
  rules: readonly TagRule[];
  keywords: readonly KeywordEntry[];
  /**
   * Not for the worker: a folder rule compares paths, which cannot hang, so
   * the caller adds its tags itself (see applyAutoTags).
   */
  folders?: readonly FolderRule[];
}

/** Tags for each file name, in the same order. */
export type DeriveAutoTags = (
  engine: AutoTagEngine,
  names: readonly string[],
) => Promise<string[][]>;

/**
 * The worker went silent with no rule to blame — not in a rule (a rule that
 * does not finish is left out, and the rest carry on), so nothing could be
 * done but give up on what was waiting.
 */
export class AutoTagTimeoutError extends Error {
  constructor() {
    super("auto-tagging worker got stuck outside any rule");
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

// How long the worker may be silent (shared with the screen's rule worker).
export { AUTO_TAG_CHUNK_TIMEOUT_MS };

interface Pending {
  engine: AutoTagEngine;
  names: readonly string[];
  resolve: (tags: string[][]) => void;
  reject: (err: Error) => void;
  /** The rules sent with it — what the worker names, by position, as it goes. */
  sent: readonly TagRule[];
}

export class AutoTagWorkerClient {
  private worker: Worker | null = null;
  private disposed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  /**
   * Watches the worker, not each request: it runs the requests one after
   * another, and each rule it starts says so. Time a request waits behind
   * others is not counted against it; only a worker that has said nothing
   * for the whole budget is stuck.
   */
  private watchdog: NodeJS.Timeout | null = null;
  /**
   * The request and the rule the worker last said it was on — null for the
   * keywords, which are nobody's fault.
   */
  private running: { id: number; at: number | null } | null = null;
  /**
   * Rules given up on, by what they do (ruleBehaviorKey), with their names.
   * Left out of every later request for the life of the app, so a rule that
   * hangs costs the budget once, not every chunk of every scan.
   */
  private readonly dropped = new Map<string, string>();

  constructor(
    private readonly workerPath: string,
    private readonly timeoutMs = AUTO_TAG_CHUNK_TIMEOUT_MS,
  ) {}

  /**
   * Bound, so it can be handed around as a plain DeriveAutoTags.
   *
   * A rule that does not finish on some name within the budget is left out —
   * the request, and every other waiting, is run again without it on a new
   * worker — so it costs that rule's tags and nothing else.
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

  /** Names of the rules left out so far (for tests). */
  droppedRules(): string[] {
    return [...this.dropped.values()];
  }

  private request(
    engine: AutoTagEngine,
    names: readonly string[],
  ): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, {
        engine,
        names,
        resolve,
        reject,
        sent: [],
      });
      this.send(id);
    });
  }

  /** Posts request `id` to the worker, without the rules given up on. */
  private send(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      this.pending.delete(id);
      p.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const rules =
      this.dropped.size === 0
        ? p.engine.rules
        : p.engine.rules.filter(
            (rule) => !this.dropped.has(ruleBehaviorKey(rule)),
          );
    p.sent = rules;
    if (!this.watchdog) this.arm();
    worker.postMessage({
      id,
      rules: [...rules],
      keywords: [...p.engine.keywords],
      names: [...p.names],
    } satisfies AutoTagWorkerRequest);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath);
    worker.unref(); // never keep the app alive on its own
    worker.on("message", (reply: AutoTagWorkerReply) => {
      if (worker !== this.worker) return;
      if (reply.type === "start") {
        this.running = { id: reply.id, at: reply.at };
        this.arm();
        return;
      }
      const p = this.pending.get(reply.id);
      if (this.running?.id === reply.id) this.running = null;
      if (!p) return;
      this.pending.delete(reply.id);
      if (this.pending.size === 0) this.stopWatchdog();
      else this.arm();
      if (reply.type === "done") p.resolve(reply.tags);
      else p.reject(new Error(reply.error));
    });
    worker.on("error", (err) => this.dropWorker(worker, err));
    worker.on("exit", () =>
      this.dropWorker(worker, new Error("auto-tag worker exited")),
    );
    this.worker = worker;
    return worker;
  }

  /**
   * The worker said nothing for the whole budget: it is stuck in the rule it
   * last named. That rule is left out from now on, and everything waiting is
   * sent again to a new worker. With no rule to blame (it never named one),
   * everything waiting fails, as a timeout.
   */
  private stuck(): void {
    this.watchdog = null;
    // The deadline may have passed because this thread was busy, not the
    // worker: let what the worker sent meanwhile be heard first. A message
    // re-arms the watchdog; with nothing left waiting there is nobody to
    // blame either.
    setImmediate(() => {
      if (this.watchdog || this.pending.size === 0) return;
      this.confirmStuck();
    });
  }

  private confirmStuck(): void {
    const worker = this.worker;
    if (!worker) return;
    const at = this.running;
    const rule =
      at && at.at !== null ? this.pending.get(at.id)?.sent[at.at] : undefined;
    if (!rule) {
      this.dropWorker(worker, new AutoTagTimeoutError());
      return;
    }
    const key = ruleBehaviorKey(rule);
    if (!this.dropped.has(key)) {
      this.dropped.set(key, rule.name);
      // The id, and the name escaped and cut short: what a user typed is not
      // let to shape the log.
      log.warn(
        `auto-tagging: rule ${rule.id} ${JSON.stringify(rule.name.slice(0, 64))} left out — it did not finish on a file name within ${this.timeoutMs} ms`,
      );
    }
    this.worker = null;
    this.running = null;
    void worker.terminate();
    for (const id of [...this.pending.keys()]) this.send(id);
  }

  private arm(): void {
    this.stopWatchdog();
    this.watchdog = setTimeout(() => this.stuck(), this.timeoutMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** Terminate `worker` and fail everything waiting on it. Idempotent. */
  private dropWorker(worker: Worker, reason: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.running = null;
    this.stopWatchdog();
    void worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.reject(reason);
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) this.dropWorker(this.worker, new Error("disposed"));
  }
}
