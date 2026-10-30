import { describe, expect, it } from "vitest";
import { defaultRules, type TagRule } from "@shared/autoTag";
import { evaluateRule } from "@/routes/AutoTag/ruleEval";
import { MAX_ROWS } from "@/routes/AutoTag/helpers";

const rule = (over: Partial<TagRule>): TagRule => ({
  ...defaultRules()[0],
  kind: "regex",
  enabled: true,
  exclude: "",
  ...over,
});

describe("evaluateRule", () => {
  it("counts the names it tags and lists the ones it matches", () => {
    const result = evaluateRule(
      rule({ pattern: "\\[([^\\]]+)\\]", template: "$1", exclude: "skip" }),
      ["[Trip] a", "b", "[skip] c", "[Port] d"],
    );
    expect([...result.matched]).toEqual([0, 2, 3]);
    // A match whose every value is excluded matches, but tags nothing.
    expect(result.tagged).toBe(2);
    expect(result.detail.map(([index]) => index)).toEqual([0, 2, 3]);
  });

  it("keeps of the tags only the words a suggestion could be, once per name", () => {
    const result = evaluateRule(
      rule({ pattern: "([A-Za-z0-9-]+)", template: "$1" }),
      ["Trip trip AB x-1 Harbor"],
    );
    expect(result.words).toEqual([[0, ["trip", "harbor"]]]);
  });

  it("sends the matches only for the rows the editor can draw", () => {
    // Every name matches many times over.
    const names = Array.from({ length: MAX_ROWS * 3 }, (_, i) => `a${i} b c d`);
    const result = evaluateRule(
      rule({ pattern: "(\\w)", template: "$1" }),
      names,
    );
    expect(result.matched).toHaveLength(names.length);
    expect(result.tagged).toBe(names.length);
    // The first rows and the first matched ones are the same here.
    expect(result.detail).toHaveLength(MAX_ROWS);
    expect(result.detail.at(-1)?.[0]).toBe(MAX_ROWS - 1);
  });

  it("finds nothing with a pattern that does not compile", () => {
    const result = evaluateRule(rule({ pattern: "(" }), ["(a)"]);
    expect(result.tagged).toBe(0);
    expect(result.matched).toHaveLength(0);
  });
});
