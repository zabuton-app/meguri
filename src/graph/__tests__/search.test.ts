import { describe, expect, it } from "vitest";
import { searchNodes } from "../model/search";
import { visibleSet } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

const g = graphOf([
  { path: "x/mugi_toy.mp4", tags: ["猫"] },
  { path: "old_mugi.jpg", tags: ["猫", "mugi"] },
  { path: "res.mp4", tags: ["res:4k"] },
]);
const v = visibleSet(g, {
  edgeSources: {},
  showAutoTags: false,
  showOrphans: false,
});

describe("searchNodes", () => {
  it("matches ignoring case and width, prefixes first", () => {
    const hits = searchNodes(g, "ＭＵＧＩ", v.nodes, v.degree);
    expect(hits.map((h) => h.key)).toEqual([
      tk("mugi"),
      fk("x/mugi_toy.mp4"),
      fk("old_mugi.jpg"),
    ]);
  });

  it("skips hidden nodes, blank text, and caps the count", () => {
    expect(searchNodes(g, "4k", v.nodes, v.degree)).toEqual([]);
    expect(searchNodes(g, "  ", v.nodes, v.degree)).toEqual([]);
    expect(searchNodes(g, "m", v.nodes, v.degree, 1)).toHaveLength(1);
  });
});
