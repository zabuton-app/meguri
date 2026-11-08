// The search box's alternatives syntax (shared/tags.ts).
import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_ALTERNATIVES,
  anyOfSearchToken,
  joinSearchTokens,
  searchTokenTerms,
  splitSearchTokens,
} from "../../../shared/tags.js";

describe("searchTokenTerms", () => {
  it("reads a plain token as one term", () => {
    expect(searchTokenTerms("yoga")).toEqual(["yoga"]);
  });

  it("reads alternatives, trimmed, dropping empty ones", () => {
    expect(searchTokenTerms("yoga|ヨガ")).toEqual(["yoga", "ヨガ"]);
    expect(searchTokenTerms("morning yoga | harbor walk")).toEqual([
      "morning yoga",
      "harbor walk",
    ]);
    expect(searchTokenTerms("a||b")).toEqual(["a", "b"]);
  });

  it("searches a separator with nothing beside it as typed", () => {
    expect(searchTokenTerms("yoga|")).toEqual(["yoga|"]);
    expect(searchTokenTerms("|yoga")).toEqual(["|yoga"]);
    expect(searchTokenTerms("|")).toEqual(["|"]);
  });

  it("takes an escaped separator as the character", () => {
    expect(searchTokenTerms("live\\|encore")).toEqual(["live|encore"]);
    expect(searchTokenTerms("a\\|b|c")).toEqual(["a|b", "c"]);
  });

  it("caps the alternatives of one token", () => {
    const many = Array.from({ length: 200 }, (_, i) => `t${i}`).join("|");
    expect(searchTokenTerms(many)).toHaveLength(MAX_SEARCH_ALTERNATIVES);
  });
});

describe("anyOfSearchToken", () => {
  /** What the search box would read back from the token. */
  const roundTrip = (terms: string[]) =>
    splitSearchTokens(anyOfSearchToken(terms)).flatMap(searchTokenTerms);

  it("joins terms into one token, without repeats that differ by case", () => {
    expect(anyOfSearchToken(["Yoga", "ヨガ", "yoga"])).toBe("Yoga|ヨガ");
  });

  it("survives the tokenizer with spaces, quotes and separators inside terms", () => {
    const terms = ["morning stretch", 'say "hi"', "live|encore", "ヨガ"];
    const token = anyOfSearchToken(terms);
    expect(splitSearchTokens(token)).toHaveLength(1);
    expect(roundTrip(terms)).toEqual(terms);
    // And through the search box's own re-serialization.
    expect(joinSearchTokens(splitSearchTokens(token))).toBe(token);
  });

  it("does not let a trailing backslash escape the next separator", () => {
    expect(roundTrip(["a\\", "b"])).toEqual(["a", "b"]);
  });
});
