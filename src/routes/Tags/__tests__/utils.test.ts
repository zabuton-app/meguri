import { describe, expect, it } from "vitest";
import type { TagSummary } from "@/ipc/types";
import {
  filterTags,
  groupTagsByNamespace,
  sortTags,
} from "@/routes/Tags/utils";

function tag(namespace: string, name: string, fileCount = 1): TagSummary {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws"],
  };
}

describe("filterTags", () => {
  const tags = [tag("", "Beach"), tag("res", "4k"), tag("", "sunset")];
  const label = (t: TagSummary) =>
    t.namespace === "res" ? "Resolution: 4K" : t.name;

  it("returns everything for a blank query", () => {
    expect(filterTags(tags, "  ", label)).toHaveLength(3);
  });

  it("matches the qualified name case-insensitively", () => {
    expect(filterTags(tags, "beach", label).map((t) => t.name)).toEqual([
      "Beach",
    ]);
    expect(filterTags(tags, "RES:", label).map((t) => t.name)).toEqual(["4k"]);
  });

  it("also matches the human-readable label", () => {
    // "Resolution" appears nowhere in the qualified name.
    expect(filterTags(tags, "resolution", label).map((t) => t.name)).toEqual([
      "4k",
    ]);
  });
});

describe("sortTags", () => {
  it("sorts by name, case-insensitively", () => {
    const out = sortTags([tag("", "beta"), tag("", "Alpha")], "name");
    expect(out.map((t) => t.name)).toEqual(["Alpha", "beta"]);
  });

  it("sorts by count descending with a name tiebreak", () => {
    const out = sortTags(
      [tag("", "b", 2), tag("", "a", 2), tag("", "c", 9)],
      "count",
    );
    expect(out.map((t) => t.name)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [tag("", "b"), tag("", "a")];
    sortTags(input, "name");
    expect(input.map((t) => t.name)).toEqual(["b", "a"]);
  });
});

describe("groupTagsByNamespace", () => {
  it("puts manual tags first, then the known namespaces in canonical order", () => {
    const out = groupTagsByNamespace([
      tag("orient", "vertical"),
      tag("res", "4k"),
      tag("", "beach"),
      tag("dur", "long"),
    ]);
    expect(out.map((g) => g.namespace)).toEqual(["", "res", "dur", "orient"]);
  });

  it("sorts unknown namespaces alphabetically after the known ones", () => {
    // The namespace set is open: a future tag source defines its own.
    const out = groupTagsByNamespace([
      tag("studio", "a24"),
      tag("res", "4k"),
      tag("", "beach"),
      tag("series", "s1"),
    ]);
    expect(out.map((g) => g.namespace)).toEqual([
      "",
      "res",
      "series",
      "studio",
    ]);
  });

  it("omits namespaces with no tags", () => {
    const out = groupTagsByNamespace([tag("res", "4k")]);
    expect(out.map((g) => g.namespace)).toEqual(["res"]);
    expect(out[0].tags).toHaveLength(1);
  });
});
