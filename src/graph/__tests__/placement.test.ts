import { describe, expect, it } from "vitest";
import { placeNodes, type Point } from "../model/placement";
import { visibleSet } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

const g = graphOf([
  { path: "a.mp4", tags: ["sea"] },
  { path: "b.mp4", tags: ["sea"] },
  { path: "c.mp4", tags: ["cat"] },
]);
const all = visibleSet(g, {
  edgeSources: {},
  showAutoTags: true,
  showOrphans: true,
});

/** A fixed sequence standing in for Math.random. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("placeNodes", () => {
  it("seats a node at its seated neighbours' centroid, jittered by the newcomers' room", () => {
    const seated = new Map<string, Point>([
      [fk("a.mp4"), [100, 0]],
      [fk("b.mp4"), [300, 0]],
    ]);
    const out = placeNodes(
      g,
      [tk("sea")],
      all,
      (k) => seated.get(k) ?? null,
      sequence(0.5),
    );
    // random() = 0.5 is no jitter at all.
    expect(out.get(tk("sea"))).toEqual([200, 0]);
    const jittered = placeNodes(
      g,
      [tk("sea")],
      all,
      (k) => seated.get(k) ?? null,
      sequence(1),
    ).get(tk("sea"));
    // Half the side of a square of 60² per newcomer.
    expect(jittered).toEqual([230, 30]);
  });

  it("seats a node with nothing seated around it in a ring outside the others", () => {
    const seated = new Map<string, Point>([[fk("a.mp4"), [300, 400]]]);
    for (const r of [0, 0.3, 0.99]) {
      const [x, y] = placeNodes(
        g,
        [tk("cat"), fk("c.mp4")],
        all,
        (k) => seated.get(k) ?? null,
        sequence(r),
      ).get(tk("cat")) ?? [0, 0];
      const d = Math.hypot(x, y);
      const outer = Math.sqrt((3600 * 2) / Math.PI + 500 * 500);
      expect(d).toBeGreaterThanOrEqual(500 - 1e-9);
      expect(d).toBeLessThanOrEqual(outer + 1e-9);
    }
  });

  it("lets a newcomer seat the ones after it", () => {
    const out = placeNodes(
      g,
      [tk("cat"), fk("c.mp4")],
      all,
      () => null,
      sequence(0.5),
    );
    expect(out.get(fk("c.mp4"))).toEqual(out.get(tk("cat")));
  });

  it("only follows links the simulation will have", () => {
    const seated = new Map<string, Point>([[fk("a.mp4"), [1000, 0]]]);
    const noLinks = { nodes: all.nodes, edges: new Set<string>() };
    const [x, y] = placeNodes(
      g,
      [tk("sea")],
      noLinks,
      (k) => seated.get(k) ?? null,
      sequence(0.5),
    ).get(tk("sea")) ?? [0, 0];
    // In the ring (radius 1000 and more), not next to a.mp4.
    expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(1000);
    expect(x).toBeLessThan(0);
  });

  it("returns nothing for nothing", () => {
    expect(placeNodes(g, [], all, () => null).size).toBe(0);
  });
});
