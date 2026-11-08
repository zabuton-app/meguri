// Messages between the screen (ruleRunner.ts) and rules.worker.ts.
import type { TagRule } from "@shared/autoTag";
import type { RuleResult } from "./ruleEval";

export type RuleRequest =
  /** The names every later run goes over, until new ones come. */
  | { type: "names"; names: readonly string[] }
  /** Run these rules, in order, in place of whatever is still to be run. */
  | { type: "run"; batch: number; rules: TagRule[] };

export type RuleResponse =
  /** Rule `at` of the batch is being run. */
  | { type: "start"; batch: number; at: number }
  /** A chunk of names done: the rule being run is not stuck. */
  | { type: "progress"; batch: number }
  | { type: "rule"; batch: number; at: number; result: RuleResult };
