// What the command menu offers for search directives (#730): their prefixes
// while a word is typed, and their values where a directive has a fixed few.
import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_COMPLETIONS,
  catalogWanted,
  prefixSuggestions,
  valueSuggestions,
} from "@/lib/directiveCompletions";
import { SEARCH_DIRECTIVE_PREFIXES } from "@shared/tags";

describe("DIRECTIVE_COMPLETIONS", () => {
  it("covers every prefix the search box reads", () => {
    const offered = Object.values(DIRECTIVE_COMPLETIONS)
      .flat()
      .map((c) => `${c.prefix}:`)
      .sort();
    expect(offered).toEqual([...SEARCH_DIRECTIVE_PREFIXES].sort());
  });
});

describe("valueSuggestions", () => {
  it("offers has:note once has: is typed, in any case and negated", () => {
    expect(valueSuggestions("has:")).toEqual(["has:note"]);
    expect(valueSuggestions("sunset HAS:N")).toEqual(["has:note"]);
    expect(valueSuggestions("has:note")).toEqual(["has:note"]);
    expect(valueSuggestions("-has:")).toEqual(["-has:note"]);
  });

  it("offers is:fav once is: is typed (#730)", () => {
    expect(valueSuggestions("is:")).toEqual(["is:fav"]);
    expect(valueSuggestions("is:f")).toEqual(["is:fav"]);
    expect(valueSuggestions("-is:")).toEqual(["-is:fav"]);
  });

  it("offers nothing before the colon, for another value, or once closed", () => {
    expect(valueSuggestions("has")).toEqual([]);
    expect(valueSuggestions("has:tags")).toEqual([]);
    expect(valueSuggestions("is:x")).toEqual([]);
    expect(valueSuggestions("tag:")).toEqual([]);
    expect(valueSuggestions("has: ")).toEqual([]);
    expect(valueSuggestions("")).toEqual([]);
  });

  it("offers the library's extensions after ext:, in the order given (#731)", () => {
    const ext = ["mp4", "mkv", "png"];
    expect(valueSuggestions("ext:", { ext })).toEqual([
      "ext:mp4",
      "ext:mkv",
      "ext:png",
    ]);
    expect(valueSuggestions("sunset EXT:M", { ext })).toEqual([
      "ext:mp4",
      "ext:mkv",
    ]);
    // `ext:` reads a leading dot as no dot, so typing one narrows the same.
    expect(valueSuggestions("ext:.p", { ext })).toEqual(["ext:png"]);
    expect(valueSuggestions("-ext:", { ext })).toEqual([
      "-ext:mp4",
      "-ext:mkv",
      "-ext:png",
    ]);
  });

  it("offers at most ten extensions", () => {
    const ext = Array.from({ length: 12 }, (_, i) => `e${i}`);
    expect(valueSuggestions("ext:", { ext })).toHaveLength(10);
  });

  it("says which directive's values come from the library (#731)", () => {
    expect(catalogWanted("ext:")).toBe("ext");
    expect(catalogWanted("sunset -ext:m")).toBe("ext");
    expect(catalogWanted("ext")).toBeNull();
    expect(catalogWanted("has:")).toBeNull();
    expect(catalogWanted("ext: ")).toBeNull();
  });

  it("offers five rating conditions before anything is typed (#732)", () => {
    expect(valueSuggestions("rating:")).toEqual([
      "rating:>=4",
      "rating:>=3",
      "rating:5",
      "rating:0",
      "rating:<=2",
    ]);
    expect(valueSuggestions("-rating:")).toEqual([
      "-rating:>=4",
      "-rating:>=3",
      "-rating:5",
      "-rating:0",
      "-rating:<=2",
    ]);
  });

  it("offers every rating condition that begins with what is typed (#732)", () => {
    const values = (draft: string) =>
      valueSuggestions(draft).map((token) => token.slice("rating:".length));
    expect(values("rating:>=")).toEqual([">=5", ">=4", ">=3", ">=2", ">=1"]);
    expect(values("rating:>")).toEqual([
      ">=5",
      ">=4",
      ">=3",
      ">=2",
      ">=1",
      ">4",
      ">3",
      ">2",
      ">1",
      ">0",
    ]);
    expect(values("rating:<")).toEqual([
      "<=0",
      "<=1",
      "<=2",
      "<=3",
      "<=4",
      "<1",
      "<2",
      "<3",
      "<4",
      "<5",
    ]);
    expect(values("rating:3")).toEqual(["3"]);
  });

  it("leaves out rating conditions that match no file or every file (#732)", () => {
    for (const draft of [
      "rating:>5",
      "rating:<0",
      "rating:>=0",
      "rating:<=5",
    ]) {
      expect(valueSuggestions(draft), draft).toEqual([]);
    }
  });

  it("offers no values for a directive whose value is free", () => {
    for (const draft of ["ext:", "size:", "hash:", "note:"]) {
      expect(valueSuggestions(draft), draft).toEqual([]);
    }
  });
});

describe("prefixSuggestions", () => {
  const tokens = (draft: string) =>
    prefixSuggestions(draft).map((s) => s.token);

  it("offers the prefixes a word begins, with their label", () => {
    expect(tokens("ra")).toEqual(["rating:"]);
    expect(tokens("sunset si")).toEqual(["size:"]);
    expect(tokens("HA")).toEqual(["hash:", "has:"]);
    expect(prefixSuggestions("ext")).toEqual([
      { token: "ext:", label: "filter.extChip" },
    ]);
  });

  it("offers them negated after a leading dash", () => {
    expect(tokens("-ra")).toEqual(["-rating:"]);
  });

  it("offers ws: and col: only for a word alone in the field, not negated", () => {
    expect(prefixSuggestions("ws")).toEqual([
      { token: "ws:", label: "filter.prefixWorkspace", page: "ws" },
    ]);
    expect(tokens("co")).toEqual(["col:"]);
    expect(tokens("sunset ws")).toEqual([]);
    expect(tokens("-ws")).toEqual([]);
  });

  it("offers nothing for one letter, a directive, a closed word or an open quote", () => {
    expect(tokens("r")).toEqual([]);
    expect(tokens("rating:")).toEqual([]);
    expect(tokens("ra ")).toEqual([]);
    expect(tokens('"ra')).toEqual([]);
    expect(tokens("sunset")).toEqual([]);
  });
});
