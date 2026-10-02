import { describe, expect, it } from "vitest";
import { visibleSet, type VisibilityOptions } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

const base: VisibilityOptions = {
  edgeSources: {},
  showAutoTags: false,
  showOrphans: false,
};

const g = graphOf([
  { path: "a.mp4", tags: ["sea", "summer", "res:4k"] },
  { path: "b.mp4", tags: ["sea", "summer"] },
  { path: "c.mp4", tags: ["sea"] },
  { path: "d.mp4", tags: ["res:4k"] },
  { path: "e.mp4", tags: ["cat"] },
  { path: "lone.mp4" },
]);

describe("visibleSet", () => {
  it("hides generated tags and the files they alone connected", () => {
    const v = visibleSet(g, base);
    expect(v.nodes.has(tk("res:4k"))).toBe(false);
    expect(v.nodes.has(fk("d.mp4"))).toBe(false);
    expect(v.nodes.has(fk("lone.mp4"))).toBe(false);
    expect(v.degree.get(fk("a.mp4"))).toBe(2);
  });

  it("shows generated tags and orphans when asked", () => {
    const v = visibleSet(g, { ...base, showAutoTags: true, showOrphans: true });
    expect(v.nodes.has(tk("res:4k"))).toBe(true);
    expect(v.nodes.has(fk("d.mp4"))).toBe(true);
    expect(v.nodes.has(fk("lone.mp4"))).toBe(true);
  });

  it("drops a relationship kind and whatever only it connected", () => {
    const v = visibleSet(g, { ...base, edgeSources: { tag: false } });
    expect(v.edges.size).toBe(0);
    expect(v.nodes.size).toBe(0);
    const orphans = visibleSet(g, {
      ...base,
      showOrphans: true,
      edgeSources: { tag: false },
    });
    expect(orphans.nodes.has(fk("a.mp4"))).toBe(true);
    expect(orphans.nodes.has(tk("sea"))).toBe(false);
  });
});
