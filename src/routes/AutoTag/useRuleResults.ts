// What each regex rule finds in the library's names, for the screen: worked
// out in a worker (ruleRunner.ts), rule by rule, as the rules change. With no
// worker the rules are not run at all: a user's regular expression never runs
// on the screen's own thread.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TagRule } from "@shared/autoTag";
import type { RuleResult } from "./ruleEval";
import { RuleRunner, type RuleOutcome } from "./ruleRunner";

export type RuleView =
  | RuleOutcome
  /**
   * Still being run. `last` is what the rule's previous version found, shown
   * meanwhile so the preview does not blank out while a pattern is typed.
   */
  | { status: "pending"; last?: RuleResult };

/**
 * What decides what a rule finds: its name, whether it is on, its place in
 * the list do not, and changing them runs nothing again.
 */
const ruleKey = (rule: TagRule): string =>
  JSON.stringify([
    rule.pattern,
    rule.ci,
    rule.template,
    rule.split,
    rule.caseMode,
    rule.exclude,
  ]);

interface Settled {
  names: readonly string[];
  outcome: RuleOutcome;
  /** Tells one result from another, for what is derived from them. */
  seq: number;
}

export interface RuleResults {
  /** Where `rule` stands against the names. */
  view: (rule: TagRule) => RuleView;
  /**
   * The suggestable words the enabled rules give each name, by position —
   * null while one of them is still running.
   */
  ruleWords: ReadonlyMap<number, ReadonlySet<string>> | null;
}

export function useRuleResults(
  rules: readonly TagRule[] | undefined,
  names: readonly string[],
): RuleResults {
  const [cache] = useState(() => new Map<string, Settled>());
  const lastById = useRef(
    new Map<string, { names: readonly string[]; result: RuleResult }>(),
  );
  const seq = useRef(0);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [runner] = useState(() =>
    typeof Worker === "undefined" ? null : new RuleRunner(),
  );
  useEffect(() => () => runner?.dispose(), [runner]);
  /** What was last sent to the runner, so the same is not sent again. */
  const asked = useRef<{ names: readonly string[]; keys: string } | null>(null);

  useEffect(() => {
    if (!rules) return;
    const settle = (rule: TagRule, outcome: RuleOutcome) => {
      cache.set(ruleKey(rule), { names, outcome, seq: ++seq.current });
      if (outcome.status === "done") {
        lastById.current.set(rule.id, { names, result: outcome.result });
      }
      bump();
    };
    // One rule per key: two rules that find the same are run once.
    const missing = new Map<string, TagRule>();
    for (const rule of rules) {
      const key = ruleKey(rule);
      if (cache.get(key)?.names !== names && !missing.has(key)) {
        missing.set(key, rule);
      }
    }
    // What is no longer asked for goes: the cache holds the current rules.
    const wanted = new Set(rules.map(ruleKey));
    for (const key of cache.keys()) if (!wanted.has(key)) cache.delete(key);
    const keys = [...missing.keys()].join("\n");
    if (missing.size === 0) return;
    if (asked.current?.names === names && asked.current.keys === keys) return;
    asked.current = { names, keys };
    if (!runner) {
      for (const rule of missing.values()) settle(rule, { status: "failed" });
      return;
    }
    runner.run(names, [...missing.values()], settle);
  }, [cache, names, rules, runner]);

  const view = useMemo(
    () =>
      (rule: TagRule): RuleView => {
        const settled = cache.get(ruleKey(rule));
        if (settled?.names === names) return settled.outcome;
        const last = lastById.current.get(rule.id);
        return {
          status: "pending",
          // Positions into these names only: a new load is another list.
          last: last?.names === names ? last.result : undefined,
        };
      },
    // `version`: a new function whenever a result comes in, so what is
    // derived from the results is worked out again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, names, version],
  );

  // Worked out again only when what an enabled rule found changes — not each
  // time a result of some other rule comes in.
  const enabled = rules?.filter((rule) => rule.enabled) ?? [];
  const signature = enabled
    .map((rule) => {
      const settled = cache.get(ruleKey(rule));
      return settled?.names === names ? settled.seq : "-";
    })
    .join(",");
  const ruleWords = useMemo(
    () => {
      if (signature.split(",").includes("-")) return null;
      const byName = new Map<number, Set<string>>();
      for (const rule of enabled) {
        const outcome = cache.get(ruleKey(rule))?.outcome;
        if (outcome?.status !== "done") continue;
        for (const [index, words] of outcome.result.words) {
          let set = byName.get(index);
          if (!set) byName.set(index, (set = new Set()));
          for (const word of words) set.add(word);
        }
      }
      return byName;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  return { view, ruleWords };
}
