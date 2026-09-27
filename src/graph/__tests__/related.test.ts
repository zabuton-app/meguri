import { describe, expect, it } from "vitest";
import { relatedFiles, tagFiles, topHubs } from "../model/related";
import { visibleSet } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

const g = graphOf([
  { path: "a.mp4", tags: ["sea", "summer", "res:4k"] },
  { path: "c.mp4", tags: ["sea"] },
  { path: "b.mp4", tags: ["sea", "summer"] },
  { path: "d.mp4", tags: ["res:4k"] },
  { path: "Ep10.mp4", tags: ["cat"] },
  { path: "Ep2.mp4", tags: ["cat"] },
]);

describe("relatedFiles", () => {
  it("ranks by shared tags, without the file itself or hidden tags", () => {
    const v = visibleSet(g, {
      edgeSources: {},
      showAutoTags: false,
      showOrphans: false,
    });
    const got = relatedFiles(g, fk("a.mp4"), v.edges);
    expect(got.map((r) => [r.label, r.score])).toEqual([
      ["b.mp4", 2],
      ["c.mp4", 1],
    ]);
    expect(got[0].shared.sort()).toEqual(["sea", "summer"]);
  });

  it("counts generated tags when they show", () => {
    const v = visibleSet(g, {
      edgeSources: {},
      showAutoTags: true,
      showOrphans: false,
    });
    expect(relatedFiles(g, fk("a.mp4"), v.edges).map((r) => r.label)).toEqual([
      "b.mp4",
      "c.mp4",
      "d.mp4",
    ]);
  });
});

describe("tagFiles / topHubs", () => {
  it("lists a tag's files in natural order", () => {
    const v = visibleSet(g, {
      edgeSources: {},
      showAutoTags: false,
      showOrphans: false,
    });
    expect(tagFiles(g, tk("cat"), v.edges).map((r) => r.label)).toEqual([
      "Ep2.mp4",
      "Ep10.mp4",
    ]);
    expect(topHubs(v.nodes, v.degree, 1)).toEqual([
      { key: tk("sea"), degree: 3 },
    ]);
  });
});
