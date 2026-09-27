import { describe, expect, it } from "vitest";
import { LayoutEngine } from "../layoutEngine";

/** A star: node 0 in the middle, 1..3 around it; node 4 on its own. */
function star(fixed = [0, 0, 0, 0, 0]) {
  return new LayoutEngine({
    xy: Float32Array.from([0, 0, 10, 0, 0, 10, -10, 0, 50, 50]),
    fixed: Uint8Array.from(fixed),
    ea: Uint32Array.from([0, 0, 0]),
    eb: Uint32Array.from([1, 2, 3]),
    weight: Float32Array.from([1, 1, 1]),
  });
}

const at = (e: LayoutEngine, i: number) => {
  const p = e.positions();
  return [p[i * 2], p[i * 2 + 1]];
};

describe("LayoutEngine", () => {
  it("never moves a pinned node", () => {
    const e = star([1, 0, 0, 0, 0]);
    e.step(50);
    expect(at(e, 0)).toEqual([0, 0]);
    expect(at(e, 1)).not.toEqual([10, 0]);
    expect(e.freeCount).toBe(4);
  });

  it("keeps a held node under the pointer and pulls its neighbours after it", () => {
    const e = star();
    e.hold(0, 300, 0, true);
    expect(e.holding).toBe(true);
    const before = at(e, 1)[0];
    e.step(60);
    expect(at(e, 0)).toEqual([300, 0]);
    expect(at(e, 1)[0]).toBeGreaterThan(before);
    e.moveHeld(400, 20);
    e.step(1);
    expect(at(e, 0)).toEqual([400, 20]);
    e.moveHeld(NaN, 1);
    expect(at(e, 0)).toEqual([400, 20]);
  });

  it("frees the held node on release, unless it was pinned from the start", () => {
    const free = star();
    free.hold(1, 100, 100);
    free.release();
    expect(free.holding).toBe(false);
    free.step(20);
    expect(at(free, 1)).not.toEqual([100, 100]);

    const pinned = star([0, 1, 0, 0, 0]);
    pinned.hold(1, 100, 100);
    pinned.release();
    pinned.step(20);
    expect(at(pinned, 1)).toEqual([100, 100]);
  });

  it("ignores a hold on a node that does not exist", () => {
    const e = star();
    e.hold(99, 1, 1);
    expect(e.holding).toBe(false);
  });
});

describe("LayoutEngine against the package's own API", () => {
  // The engine drives the package's internal iterate.js on matrices laid out
  // the way its helpers.js lays them out. If an update changed that layout,
  // this would drift from the public API's result.
  it("matches forceAtlas2.assign on the same graph", async () => {
    const { default: Graph } = await import("graphology");
    const { default: forceAtlas2 } =
      await import("graphology-layout-forceatlas2");
    const { settingsFor } = await import("../layoutEngine");
    const xy = [0, 0, 10, 0, 0, 10, -10, 0, 5, 5, 30, -20];
    const edges: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 4],
      [4, 5],
    ];
    const g = new Graph({ type: "undirected" });
    for (let i = 0; i < 6; i++)
      g.addNode(String(i), { x: xy[i * 2], y: xy[i * 2 + 1], size: 1 });
    for (const [a, b] of edges) g.addEdge(String(a), String(b), { weight: 1 });
    forceAtlas2.assign(g, { iterations: 25, settings: settingsFor(6) });

    const e = new LayoutEngine({
      xy: Float32Array.from(xy),
      fixed: new Uint8Array(6),
      ea: Uint32Array.from(edges.map(([a]) => a)),
      eb: Uint32Array.from(edges.map(([, b]) => b)),
      weight: Float32Array.from(edges.map(() => 1)),
    });
    e.step(25);
    for (let i = 0; i < 6; i++) {
      const [x, y] = at(e, i);
      expect(x).toBeCloseTo(g.getNodeAttribute(String(i), "x") as number, 2);
      expect(y).toBeCloseTo(g.getNodeAttribute(String(i), "y") as number, 2);
    }
  });
});
