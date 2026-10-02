import { describe, expect, it } from "vitest";
import { buildGraphology } from "../model/buildGraphology";
import { fk, graphOf, payloadOf, tk } from "./fixtures";

describe("buildGraphology", () => {
  it("adds a node per file and tag and an edge per link", () => {
    const g = graphOf([
      { path: "a/beach.mp4", tags: ["sea", "res:4k"] },
      { path: "cat.jpg", kind: "image", tags: ["sea"] },
    ]);
    expect(g.order).toBe(4);
    expect(g.size).toBe(3);
    expect(g.getNodeAttributes(fk("a/beach.mp4"))).toMatchObject({
      type: "file",
      label: "beach.mp4",
      fileKind: "video",
    });
    expect(g.getNodeAttributes(tk("res:4k"))).toMatchObject({
      type: "tag",
      label: "res:4k",
      auto: true,
    });
    expect(g.getNodeAttributes(tk("sea"))).toMatchObject({ auto: false });
  });

  it("links files of different workspaces through one tag node", () => {
    const g = graphOf([
      { ws: "w1", path: "a.mp4", tags: ["sea"] },
      { ws: "w2", path: "b.mp4", tags: ["sea"] },
    ]);
    expect(g.neighbors(tk("sea")).sort()).toEqual(
      [fk("a.mp4", "w1"), fk("b.mp4", "w2")].sort(),
    );
  });

  it("carries positions over from the previous graph and reports new nodes", () => {
    const prev = graphOf([{ path: "a.mp4", tags: ["sea"] }]);
    prev.setNodeAttribute(fk("a.mp4"), "x", 42);
    const { graph, added } = buildGraphology(
      payloadOf([
        { path: "a.mp4", tags: ["sky"] },
        { path: "b.mp4", tags: ["sky"] },
      ]),
      prev,
    );
    expect(graph).not.toBe(prev);
    expect(graph.getNodeAttribute(fk("a.mp4"), "x")).toBe(42);
    expect(added.sort()).toEqual([fk("b.mp4"), tk("sky")].sort());
    expect(graph.hasNode(tk("sea"))).toBe(false);
    expect(graph.size).toBe(2);
  });

  it("keeps links apart whatever characters the names hold", () => {
    // Joined naively with "|", these two (file, tag) pairs would share a key.
    const g = graphOf([
      { path: "x|t::y", tags: ["z"] },
      { path: "x", tags: ["y|t::z"] },
    ]);
    expect(g.size).toBe(2);
  });
});
