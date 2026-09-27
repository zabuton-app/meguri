import { describe, expect, it } from "vitest";
import {
  dragReach,
  DRAG_REACH_MAX,
  layoutPlan,
  placeNodes,
  seedPosition,
  type Point,
} from "../model/placement";
import { fk, graphOf, tk } from "./fixtures";

describe("seedPosition", () => {
  it("is deterministic and inside the disc", () => {
    const a = seedPosition("k", 100);
    expect(seedPosition("k", 100)).toEqual(a);
    expect(Math.hypot(a[0], a[1])).toBeLessThanOrEqual(100);
    expect(seedPosition("other", 100)).not.toEqual(a);
  });
});

describe("placeNodes", () => {
  const g = graphOf([
    { path: "a.mp4", tags: ["sea"] },
    { path: "b.mp4", tags: ["sea"] },
    { path: "c.mp4", tags: ["cat"] },
  ]);

  it("uses a known position first", () => {
    const known = new Map<string, Point>([[fk("a.mp4"), [5, 6]]]);
    expect(placeNodes(g, [fk("a.mp4")], known).get(fk("a.mp4"))).toEqual([
      5, 6,
    ]);
  });

  it("puts a new node next to its placed neighbours", () => {
    const known = new Map<string, Point>([[tk("sea"), [1000, 1000]]]);
    const [x, y] = placeNodes(g, [fk("b.mp4")], known).get(fk("b.mp4")) ?? [
      0, 0,
    ];
    expect(Math.hypot(x - 1000, y - 1000)).toBeLessThan(10);
  });

  it("seeds a node with no placed neighbour from its key", () => {
    const out = placeNodes(g, [fk("c.mp4")], new Map());
    expect(out.get(fk("c.mp4"))).toEqual(
      placeNodes(g, [fk("c.mp4")], new Map()).get(fk("c.mp4")),
    );
  });
});

describe("layoutPlan", () => {
  it("skips, pins or runs fully by the share of new nodes", () => {
    expect(layoutPlan(100, 0)).toBe("none");
    expect(layoutPlan(100, 10)).toBe("fixed-partial");
    expect(layoutPlan(100, 20)).toBe("full");
    expect(layoutPlan(100, 0, true)).toBe("full");
    expect(layoutPlan(0, 0, true)).toBe("none");
  });
});

describe("dragReach", () => {
  const g = graphOf([
    { path: "a.mp4", tags: ["sea", "res:4k"] },
    { path: "b.mp4", tags: ["sea"] },
    { path: "c.mp4", tags: ["cat"] },
  ]);

  it("frees the neighbours and their neighbours, skipping what it is told to", () => {
    const reach = dragReach(g, fk("a.mp4"), (k) => k === tk("res:4k"));
    expect([...reach].sort()).toEqual(
      [fk("a.mp4"), tk("sea"), fk("b.mp4")].sort(),
    );
  });

  it("stops at the neighbours when theirs would be too many", () => {
    const files = Array.from({ length: DRAG_REACH_MAX + 10 }, (_, i) => ({
      path: `f${i}.mp4`,
      tags: ["hub"],
    }));
    const big = graphOf([{ path: "x.mp4", tags: ["hub", "small"] }, ...files]);
    const reach = dragReach(big, fk("x.mp4"));
    expect([...reach].sort()).toEqual(
      [fk("x.mp4"), tk("hub"), tk("small")].sort(),
    );
  });
});
