// Drives rules.worker.ts. Each chunk of names a rule runs over is under a
// deadline; a rule that misses it is given up on — the worker, stuck in it,
// is ended, and a new one carries on with the rules still to run — so a
// pattern that backtracks without end costs the screen one rule's preview,
// never the screen. A new run takes the place of the rules still waiting in
// the same worker; only a deadline ends one.
import log from "@/lib/logger";
import { AUTO_TAG_CHUNK_TIMEOUT_MS, type TagRule } from "@shared/autoTag";
import type { RuleResult } from "./ruleEval";
import type { RuleRequest, RuleResponse } from "./ruleProtocol";

export type RuleOutcome =
  | { status: "done"; result: RuleResult }
  /** A chunk of names took longer than the deadline. */
  | { status: "timedOut" }
  /** The worker could not run it (it could not start, say). */
  | { status: "failed" };

const createRuleWorker = (): Worker =>
  new Worker(new URL("./rules.worker.ts", import.meta.url), {
    type: "module",
  });

/** What a caller asked for: these rules, and who hears of them. */
interface Job {
  names: readonly string[];
  rules: readonly TagRule[];
  heard: Set<TagRule>;
  onResult: (rule: TagRule, outcome: RuleOutcome) => void;
}

export class RuleRunner {
  private worker: Worker | null = null;
  /** The names the current worker holds. */
  private sent: readonly string[] | null = null;
  private job: Job | null = null;
  /** The rules of each run sent to the current worker, by batch. */
  private batches = new Map<number, readonly TagRule[]>();
  private lastBatch = 0;
  /** The rule the worker said it is running. */
  private running: TagRule | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly create: () => Worker = createRuleWorker,
    private readonly timeoutMs = AUTO_TAG_CHUNK_TIMEOUT_MS,
  ) {}

  /**
   * Run `rules` over `names`. `onResult` hears of each rule as it is done or
   * given up on; a later call takes this one's place, and nothing more is
   * heard of this one.
   */
  run(
    names: readonly string[],
    rules: readonly TagRule[],
    onResult: (rule: TagRule, outcome: RuleOutcome) => void,
  ): void {
    this.job = { names, rules, heard: new Set(), onResult };
    this.send(this.job);
  }

  dispose(): void {
    this.job = null;
    this.stopTimer();
    this.drop();
  }

  private send(job: Job): void {
    const rest = job.rules.filter((rule) => !job.heard.has(rule));
    if (rest.length === 0) {
      this.stopTimer();
      return;
    }
    let worker: Worker;
    try {
      worker = this.ensure(job.names);
    } catch (e) {
      log.warn("auto-tagging rule worker unavailable:", e);
      for (const rule of rest) this.hear(job, rule, { status: "failed" });
      return;
    }
    const batch = ++this.lastBatch;
    this.batches.set(batch, rest);
    // The deadline runs from the worker's last sign of life: a worker busy
    // with an earlier run (maybe stuck in it) gets no fresh time for this one.
    if (this.timer === null) this.arm();
    this.post(worker, { type: "run", batch, rules: [...rest] });
  }

  private ensure(names: readonly string[]): Worker {
    if (!this.worker) {
      const worker = this.create();
      worker.onmessage = (e: MessageEvent<RuleResponse>) =>
        this.receive(worker, e.data);
      worker.onerror = (e) => {
        if (worker !== this.worker) return;
        log.warn("auto-tagging rule worker failed:", e.message);
        this.giveUp({ status: "failed" });
      };
      this.worker = worker;
    }
    if (this.sent !== names) {
      this.post(this.worker, { type: "names", names });
      this.sent = names;
    }
    return this.worker;
  }

  private receive(worker: Worker, msg: RuleResponse): void {
    // A worker given up on may still have had messages on their way.
    if (worker !== this.worker) return;
    const job = this.job;
    if (msg.type === "start") {
      this.running = this.batches.get(msg.batch)?.[msg.at] ?? null;
    } else if (msg.type === "rule") {
      const rule = this.batches.get(msg.batch)?.[msg.at];
      this.running = null;
      // An earlier run's rule counts when this run asked for it too.
      if (job && rule && job.rules.includes(rule)) {
        this.hear(job, rule, { status: "done", result: msg.result });
      }
    }
    if (job && job.rules.every((rule) => job.heard.has(rule))) {
      this.stopTimer();
      this.batches.clear();
    } else {
      this.arm();
    }
  }

  /** The worker is stuck (or broken): end it, and carry on without the rule. */
  private giveUp(outcome: RuleOutcome): void {
    this.stopTimer();
    const stuck = this.running;
    this.drop();
    const job = this.job;
    if (!job) return;
    // Stuck in a rule of an earlier run that this one no longer asks for:
    // nothing to say about it. Not started yet: the first one waiting is the
    // one that did not get going.
    const culprit =
      stuck ?? job.rules.find((rule) => !job.heard.has(rule)) ?? null;
    if (culprit && job.rules.includes(culprit)) {
      this.hear(job, culprit, outcome);
    }
    this.send(job);
  }

  private hear(job: Job, rule: TagRule, outcome: RuleOutcome): void {
    if (job !== this.job || job.heard.has(rule)) return;
    job.heard.add(rule);
    job.onResult(rule, outcome);
  }

  private arm(): void {
    this.stopTimer();
    this.timer = setTimeout(
      () => this.giveUp({ status: "timedOut" }),
      this.timeoutMs,
    );
  }

  private post(worker: Worker, req: RuleRequest): void {
    worker.postMessage(req);
  }

  private drop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.sent = null;
    this.running = null;
    this.batches.clear();
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
