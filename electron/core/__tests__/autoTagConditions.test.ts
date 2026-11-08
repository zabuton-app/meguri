// What the tag screen's rename, merge and delete do to the auto-tagging
// conditions that name the tags.
import { describe, expect, it } from "vitest";
import {
  defaultAutoTagConfig,
  type AutoTagConfig,
} from "../../../shared/autoTag.js";
import { retagConditions } from "../../../shared/autoTagConditions.js";

function config(
  keywordTags: string[][],
  folderTags: string[][] = [],
): AutoTagConfig {
  return {
    ...defaultAutoTagConfig(),
    keywords: keywordTags.map((tags, i) => ({
      id: `k${i}`,
      terms: [`term${i}`],
      tags,
      mode: "word",
    })),
    folders: folderTags.map((tags, i) => ({
      id: `f${i}`,
      workspaceId: `ws${i}`,
      folder: `dir${i}`,
      tags,
      enabled: true,
    })),
  };
}

const tagsOf = (c: AutoTagConfig) => ({
  keywords: c.keywords.map((k) => k.tags),
  folders: c.folders.map((f) => f.tags),
});

describe("retagConditions", () => {
  it("renames the tag in keyword entries and folder rules, in its place", () => {
    const before = config([["a", "trip", "b"], ["c"]], [["trip"]]);
    expect(tagsOf(retagConditions(before, ["trip"], "travel"))).toEqual({
      keywords: [["a", "travel", "b"], ["c"]],
      folders: [["travel"]],
    });
  });

  it("matches the names case aside, as the tags themselves are matched", () => {
    const before = config([["Été"]], [["TRIP"]]);
    const after = retagConditions(before, ["été", "trip"], "summer");
    expect(tagsOf(after)).toEqual({
      keywords: [["summer"]],
      folders: [["summer"]],
    });
  });

  it("merges into one tag without repeating it", () => {
    const before = config([["x", "into", "a", "b"]]);
    expect(tagsOf(retagConditions(before, ["a", "b"], "into"))).toEqual({
      keywords: [["x", "into"]],
      folders: [],
    });
    // The merged tags may stand before the one they merge into.
    const first = config([["a", "x", "Into"]]);
    expect(tagsOf(retagConditions(first, ["a"], "into"))).toEqual({
      keywords: [["into", "x"]],
      folders: [],
    });
  });

  it("drops a deleted tag, and keeps a condition left with no tags", () => {
    const before = config([["trip", "a"], ["trip"]], [["trip"]]);
    const after = retagConditions(before, ["trip"], null);
    expect(tagsOf(after)).toEqual({
      keywords: [["a"], []],
      folders: [[]],
    });
    expect(after.keywords[1].terms).toEqual(["term1"]);
    expect(after.folders[0].folder).toBe("dir0");
  });

  it("returns the same config when no condition names the tags", () => {
    const before = config([["a"]], [["b"]]);
    expect(retagConditions(before, ["trip"], "travel")).toBe(before);
    expect(retagConditions(before, ["trip"], null)).toBe(before);
    expect(retagConditions(before, [], null)).toBe(before);
  });

  it("leaves the rest of the config alone", () => {
    const before = config([["trip"]]);
    const after = retagConditions(before, ["trip"], "travel");
    expect(after.rules).toBe(before.rules);
    expect(after.ignored).toBe(before.ignored);
    expect(after.applyOnScan).toBe(before.applyOnScan);
  });
});
