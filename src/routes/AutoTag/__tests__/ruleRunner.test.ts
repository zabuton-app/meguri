// RuleRunner against a stand-in worker: results rule by rule, a rule given up
// on when a chunk of names misses the deadline, a later run taking an earlier
// one's place, and nothing heard from a worker that was ended.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRules, type TagRule } from "@shared/autoTag";
import type { RuleResult } from "../ruleEval";
import type { RuleRequest, RuleResponse } from "../ruleProtocol";
import { RuleRunner, type RuleOutcome } from "../ruleRunner";

class FakeWorker {
  static all: FakeWorker[] = [];
  sent: RuleRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<RuleResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: RuleRequest) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** The last run it was sent. */
  get run(): RuleRequest & { type: "run" } {
    const run = this.sent.filter((m) => m.type === "run").at(-1);
    if (run?.type !== "run") throw new Error("no run sent");
    return run;
  }
  start(at: number, batch = this.run.batch) {
    this.reply({ type: "start", batch, at });
  }
  finish(at: number, batch = this.run.batch) {
    this.reply({ type: "rule", batch, at, result: RESULT });
  }
  reply(msg: RuleResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<RuleResponse>);
  }
}

const NAMES = ["[Trip] a.mp4", "b.mp4"];
const RESULT: RuleResult = {
  tagged: 1,
  matched: Int32Array.from([0]),
  detail: [],
  words: [[0, ["trip"]]],
};
const rules = (): TagRule[] => defaultRules().slice(0, 3);

function make(
  create: () => Worker = () => new FakeWorker() as unknown as Worker,
) {
  return new RuleRunner(create, 1000);
}

function start(runner: RuleRunner, list: readonly TagRule[]) {
  const heard: [string, RuleOutcome["status"]][] = [];
  runner.run(NAMES, list, (rule, outcome) =>
    heard.push([rule.id, outcome.status]),
  );
  return heard;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.all = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RuleRunner", () => {
  it("sends the names once, then hears of each rule as it is done", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    const worker = FakeWorker.all[0];
    expect(worker.sent.map((m) => m.type)).toEqual(["names", "run"]);
    for (const at of [0, 1, 2]) {
      worker.start(at);
      worker.finish(at);
    }
    expect(heard).toEqual(list.map((rule) => [rule.id, "done"]));
    // Done: no deadline left running, and the same names are not sent again.
    vi.advanceTimersByTime(5000);
    expect(worker.terminated).toBe(false);
    start(runner, list.slice(0, 1));
    expect(worker.sent.map((m) => m.type)).toEqual(["names", "run", "run"]);
  });

  it("gives up on the rule that misses the deadline, and carries on without it", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    const first = FakeWorker.all[0];
    first.start(0);
    first.finish(0);
    first.start(1);
    // Signs of life keep the rule going…
    vi.advanceTimersByTime(900);
    first.reply({ type: "progress", batch: first.run.batch });
    vi.advanceTimersByTime(900);
    expect(heard).toEqual([[list[0].id, "done"]]);
    // …until a chunk takes too long.
    vi.advanceTimersByTime(200);
    expect(heard).toEqual([
      [list[0].id, "done"],
      [list[1].id, "timedOut"],
    ]);
    expect(first.terminated).toBe(true);
    // A new worker, the names again, and only the rule still to run.
    const second = FakeWorker.all[1];
    expect(second.sent[0]).toEqual({ type: "names", names: NAMES });
    expect(second.run.rules.map((r: TagRule) => r.id)).toEqual([list[2].id]);
    second.start(0);
    second.finish(0);
    expect(heard.at(-1)).toEqual([list[2].id, "done"]);
  });

  it("blames the first rule waiting when the worker never got going", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    vi.advanceTimersByTime(1000);
    expect(heard).toEqual([[list[0].id, "timedOut"]]);
  });

  it("hears nothing from a worker that was ended", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    const first = FakeWorker.all[0];
    first.start(0);
    vi.advanceTimersByTime(1000);
    expect(heard).toEqual([[list[0].id, "timedOut"]]);
    // Messages it had on the way, and its errors, change nothing.
    first.finish(1);
    first.onerror?.({ message: "late" } as ErrorEvent);
    expect(heard).toEqual([[list[0].id, "timedOut"]]);
    // The new worker's deadline is its own.
    const second = FakeWorker.all[1];
    second.start(0);
    vi.advanceTimersByTime(900);
    second.finish(0);
    expect(heard.at(-1)).toEqual([list[1].id, "done"]);
  });

  it("puts a new run in place of the rules still waiting, in the same worker", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    const worker = FakeWorker.all[0];
    const earlier = worker.run.batch;
    worker.start(0, earlier);
    // A new run while the first rule is going: no new worker, no names again.
    const next = start(runner, [list[0], list[2]]);
    expect(FakeWorker.all).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    expect(worker.sent.map((m) => m.type)).toEqual(["names", "run", "run"]);
    // The rule the worker was on counts for the new run, which asked for it
    // too; what only the earlier run asked for is not heard of.
    worker.finish(0, earlier);
    worker.finish(1, earlier);
    expect(heard).toEqual([]);
    expect(next).toEqual([[list[0].id, "done"]]);
    // The deadline was not started over by the new run: a worker stuck in
    // the earlier run's rule is given up on all the same.
    worker.start(1);
    vi.advanceTimersByTime(1000);
    expect(next.at(-1)).toEqual([list[2].id, "timedOut"]);
  });

  it("does not take an earlier run's result over other names", () => {
    const runner = make();
    const list = rules();
    start(runner, list);
    const worker = FakeWorker.all[0];
    const earlier = worker.run.batch;
    worker.start(0, earlier);
    // The files are read again while the first rule is going: same rule
    // objects, other names.
    const heard: [string, RuleOutcome["status"]][] = [];
    runner.run(["c.mp4"], list, (rule, outcome) =>
      heard.push([rule.id, outcome.status]),
    );
    expect(worker.sent.map((m) => m.type)).toEqual([
      "names",
      "run",
      "names",
      "run",
    ]);
    worker.finish(0, earlier);
    expect(heard).toEqual([]);
    // Its own result, over the new names, is.
    worker.start(0);
    worker.finish(0);
    expect(heard).toEqual([[list[0].id, "done"]]);
  });

  it("does not blame a rule for sticking over names it is no longer run on", () => {
    const runner = make();
    const list = rules();
    start(runner, list);
    const first = FakeWorker.all[0];
    first.start(0);
    const heard: [string, RuleOutcome["status"]][] = [];
    runner.run(["c.mp4"], list, (rule, outcome) =>
      heard.push([rule.id, outcome.status]),
    );
    // Stuck in the rule over the old names: given up on, but not said to be
    // too slow for the new ones — it is run over them in a new worker.
    vi.advanceTimersByTime(1000);
    expect(heard).toEqual([]);
    const second = FakeWorker.all[1];
    expect(second.sent[0]).toEqual({ type: "names", names: ["c.mp4"] });
    expect(second.run.rules.map((r: TagRule) => r.id)).toEqual(
      list.map((r) => r.id),
    );
  });

  it("says the rules failed when there is no worker to run them", () => {
    const runner = make(() => {
      throw new Error("no worker");
    });
    const list = rules();
    expect(start(runner, list)).toEqual(
      list.map((rule) => [rule.id, "failed"]),
    );
  });

  it("says a rule failed when the worker does, and carries on", () => {
    const runner = make();
    const list = rules();
    const heard = start(runner, list);
    FakeWorker.all[0].start(0);
    FakeWorker.all[0].onerror?.({ message: "boom" } as ErrorEvent);
    expect(heard).toEqual([[list[0].id, "failed"]]);
    const second = FakeWorker.all[1];
    expect(second.run.rules.map((r: TagRule) => r.id)).toEqual(
      list.slice(1).map((r) => r.id),
    );
  });

  it("hears nothing after it is disposed", () => {
    const runner = make();
    const heard = start(runner, rules());
    runner.dispose();
    expect(FakeWorker.all[0].terminated).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(heard).toEqual([]);
  });
});
