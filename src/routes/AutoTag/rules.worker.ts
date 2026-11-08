// The auto-tagging screen's regex rules, run off the main thread: a pattern
// that backtracks without end stalls this worker, which the screen can end,
// and never the screen itself (see ruleRunner.ts). Rules are run one at a
// time with a turn of the event loop between them, so a new run takes the
// place of the rules still to be run instead of waiting behind them.
import type { TagRule } from "@shared/autoTag";
import { evaluateRule } from "./ruleEval";
import type { RuleRequest, RuleResponse } from "./ruleProtocol";

let names: readonly string[] = [];
let queue: { batch: number; rules: TagRule[] } | null = null;
let next = 0;
let scheduled = false;

const post = (msg: RuleResponse, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(msg, transfer);

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(step, 0);
}

function step(): void {
  scheduled = false;
  if (!queue || next >= queue.rules.length) return;
  const { batch } = queue;
  const at = next++;
  post({ type: "start", batch, at });
  const result = evaluateRule(queue.rules[at], names, () =>
    post({ type: "progress", batch }),
  );
  post({ type: "rule", batch, at, result }, [result.matched.buffer]);
  schedule();
}

self.onmessage = (e: MessageEvent<RuleRequest>) => {
  const req = e.data;
  if (req.type === "names") {
    names = req.names;
    return;
  }
  queue = { batch: req.batch, rules: req.rules };
  next = 0;
  schedule();
};
