// A stand-in for rules.worker.ts in a test environment, which has no Worker:
// it answers at once, in the same call, so a test sees a rule's result as soon
// as the screen has asked for it. A rule `hangs` says is never answered, as a
// pattern that backtracks without end would not be.
import type { TagRule } from "@shared/autoTag";
import { evaluateRule } from "../ruleEval";
import type { RuleRequest, RuleResponse } from "../ruleProtocol";

export function fakeRuleWorker(
  hangs: (rule: TagRule) => boolean = () => false,
) {
  return class FakeRuleWorker {
    names: readonly string[] = [];
    onmessage: ((e: MessageEvent<RuleResponse>) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(req: RuleRequest) {
      if (req.type === "names") {
        this.names = req.names;
        return;
      }
      for (const [at, rule] of req.rules.entries()) {
        this.reply({ type: "start", batch: req.batch, at });
        if (hangs(rule)) return;
        this.reply({
          type: "rule",
          batch: req.batch,
          at,
          result: evaluateRule(rule, this.names),
        });
      }
    }
    terminate() {}
    private reply(data: RuleResponse) {
      this.onmessage?.({ data } as MessageEvent<RuleResponse>);
    }
  };
}
