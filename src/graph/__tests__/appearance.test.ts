import { describe, expect, it } from "vitest";
import { fade, nodeRadius, nodeWeights } from "../model/appearance";
import { visibleSet } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

describe("nodeRadius", () => {
  it("grows with the square root of the links, between 8 and 30", () => {
    expect(nodeRadius(0)).toBe(8);
    expect(nodeRadius(15)).toBe(12);
    expect(nodeRadius(10_000)).toBe(30);
    expect(nodeRadius(15, 2)).toBe(24);
  });
});

describe("nodeWeights", () => {
  const g = graphOf([
    { path: "a.mp4", tags: ["sea", "res:4k"], plays: 5 },
    { path: "b.mp4", tags: ["sea"], plays: 2 },
    { path: "c.mp4", tags: ["cat"] },
  ]);
  const vis = visibleSet(g, {
    edgeSources: {},
    showAutoTags: false,
    showOrphans: false,
  });

  it("are the visible links by default", () => {
    expect(nodeWeights(g, vis, "links")).toBe(vis.degree);
  });

  it("are a file's plays, and the plays of a tag's visible files", () => {
    const w = nodeWeights(g, vis, "plays");
    expect(w.get(fk("a.mp4"))).toBe(5);
    expect(w.get(fk("c.mp4"))).toBe(0);
    expect(w.get(tk("sea"))).toBe(7);
    expect(w.get(tk("cat"))).toBe(0);
    // Hidden generated tags are not weighed.
    expect(w.has(tk("res:4k"))).toBe(false);
  });
});

describe("fade", () => {
  it("mixes a colour into the background", () => {
    expect(fade("#ffffff", "#000000", 0.2)).toBe("#333333");
    expect(fade("#f00", "#0000ff", 0.5)).toBe("#800080");
    expect(fade("rgb(200, 100, 0)", "rgb(0 0 0)", 0.5)).toBe("#643200");
    expect(fade("#123456", "#abcdef", 1)).toBe("#123456");
  });

  it("leaves colours it cannot read alone", () => {
    expect(fade("red", "#000000", 0.2)).toBe("red");
    expect(fade("#ffffff", "transparent", 0.2)).toBe("#ffffff");
  });
});
