// The graph view's position cache: where each scope's file lives, what is
// accepted back from disk, and how saves of a partial graph merge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectionLayoutPaths,
  keepRegisteredWorkspaces,
  layoutPathFor,
  readLayout,
  readLayoutSettled,
  removeLayout,
  removeWorkspaceWithLayouts,
  writeLayout,
  type LayoutScopes,
} from "../graph/layoutCache.js";
import { GRAPH_LAYOUT_MAX_NODES } from "../../../shared/ipc/graph.js";

let base: string;

function scopes(): LayoutScopes {
  return {
    baseDir: base,
    workspaceDataDir: (id) =>
      id === "0123456789abcdef" ? path.join(base, "roots", id) : null,
    hasCollection: (id) => id === "c1",
    workspaceIds: () => new Set(["0123456789abcdef"]),
  };
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-layout-"));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("layoutPathFor", () => {
  it("puts a workspace's file in its data directory", () => {
    expect(layoutPathFor("0123456789abcdef", scopes())).toBe(
      path.join(base, "roots", "0123456789abcdef", "graph-layout.json"),
    );
  });

  it("puts All and collections under graph-layouts/, by a hash of the scope", () => {
    const all = layoutPathFor("__all__", scopes());
    const col = layoutPathFor("collection:c1", scopes());
    expect(path.dirname(all ?? "")).toBe(path.join(base, "graph-layouts"));
    expect(path.basename(col ?? "")).toMatch(/^[0-9a-f]{16}\.json$/);
    expect(col).not.toBe(all);
    expect(col).toBe(collectionLayoutPaths(base, "c1")[0]);
  });

  it("keeps the 3D layout in a file of its own", () => {
    const ws2 = layoutPathFor("0123456789abcdef", scopes());
    const ws3 = layoutPathFor("0123456789abcdef", scopes(), 3);
    expect(path.dirname(ws3 ?? "")).toBe(path.dirname(ws2 ?? ""));
    expect(ws3).not.toBe(ws2);
    const col3 = layoutPathFor("collection:c1", scopes(), 3);
    expect(col3).not.toBe(layoutPathFor("collection:c1", scopes()));
    expect(collectionLayoutPaths(base, "c1")).toContain(col3);
    expect(layoutPathFor("__all__", scopes(), 3)).not.toBe(
      layoutPathFor("__all__", scopes()),
    );
  });

  it("has no file for a scope that does not exist", () => {
    expect(layoutPathFor("ffffffffffffffff", scopes())).toBeNull();
    expect(layoutPathFor("collection:gone", scopes())).toBeNull();
  });
});

describe("readLayout / writeLayout", () => {
  const file = () => path.join(base, "x", "graph-layout.json");

  it("round-trips positions", async () => {
    await writeLayout(file(), { keys: ["t::a", "t::b"], xy: [1, 2, 3, 4] });
    expect(await readLayout(file())).toEqual({
      keys: ["t::a", "t::b"],
      xy: [1, 2, 3, 4],
    });
  });

  it("keeps keys a partial save did not send, and updates the ones it did", async () => {
    await writeLayout(file(), { keys: ["t::a", "t::b"], xy: [1, 2, 3, 4] });
    await writeLayout(file(), { keys: ["t::b", "t::c"], xy: [30, 40, 5, 6] });
    const got = await readLayout(file());
    expect(got?.keys).toEqual(["t::a", "t::b", "t::c"]);
    expect(got?.xy).toEqual([1, 2, 30, 40, 5, 6]);
  });

  it("drops stored keys the keep test rejects", async () => {
    await writeLayout(file(), {
      keys: ["f:0123456789abcdef:h1", "f:gone:h2", "t::a"],
      xy: [0, 0, 1, 1, 2, 2],
    });
    await writeLayout(
      file(),
      { keys: [], xy: [] },
      keepRegisteredWorkspaces(new Set(["0123456789abcdef"])),
    );
    expect((await readLayout(file()))?.keys).toEqual([
      "f:0123456789abcdef:h1",
      "t::a",
    ]);
  });

  it("does not write back an updated key the keep test rejects", async () => {
    await writeLayout(
      file(),
      { keys: ["f:0123456789abcdef:h1", "f:gone:h2"], xy: [0, 0, 1, 1] },
      keepRegisteredWorkspaces(new Set(["0123456789abcdef"])),
    );
    expect((await readLayout(file()))?.keys).toEqual(["f:0123456789abcdef:h1"]);
  });

  it("reads the registered workspaces when the write runs", async () => {
    const ids = new Set(["0123456789abcdef", "fedcba9876543210"]);
    const write = writeLayout(
      file(),
      {
        keys: ["f:0123456789abcdef:h1", "f:fedcba9876543210:h2"],
        xy: [0, 0, 1, 1],
      },
      keepRegisteredWorkspaces(() => ids),
    );
    // Removed after the save was sent, before it was written.
    ids.delete("fedcba9876543210");
    await write;
    expect((await readLayout(file()))?.keys).toEqual(["f:0123456789abcdef:h1"]);
  });

  it("drops the oldest untouched keys past the size cap", async () => {
    const n = GRAPH_LAYOUT_MAX_NODES;
    const keys = Array.from({ length: n }, (_, i) => `t::${i}`);
    await writeLayout(file(), { keys, xy: new Array<number>(n * 2).fill(0) });
    await writeLayout(file(), { keys: ["t::new"], xy: [9, 9] });
    const got = await readLayout(file());
    expect(got?.keys.length).toBe(n);
    expect(got?.keys[0]).toBe("t::1");
    expect(got?.keys[n - 1]).toBe("t::new");
  });

  it.each([
    ["broken JSON", "{"],
    ["another version", JSON.stringify({ v: 2, keys: [], xy: [] })],
    ["a length mismatch", JSON.stringify({ v: 1, keys: ["t::a"], xy: [1] })],
    [
      "a non-finite number",
      JSON.stringify({ v: 1, keys: ["t::a"], xy: [1, "x"] }),
    ],
    ["a non-string key", JSON.stringify({ v: 1, keys: [1], xy: [1, 2] })],
  ])("ignores a file with %s", async (_label, body) => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), body);
    expect(await readLayout(file())).toBeNull();
  });

  it("reads nothing when there is no file, and removal is idempotent", async () => {
    expect(await readLayout(file())).toBeNull();
    await writeLayout(file(), { keys: ["t::a"], xy: [1, 2] });
    await removeLayout(file());
    await removeLayout(file());
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("3D layouts", () => {
  it("round-trip three numbers per key and merge like 2D ones", async () => {
    const file = path.join(base, "d", "graph-layout-3d.json");
    await writeLayout(
      file,
      { keys: ["t::a", "t::b"], xy: [1, 2, 3, 4, 5, 6] },
      undefined,
      3,
    );
    await writeLayout(file, { keys: ["t::b"], xy: [7, 8, 9] }, undefined, 3);
    expect(await readLayout(file, 3)).toEqual({
      keys: ["t::a", "t::b"],
      xy: [1, 2, 3, 7, 8, 9],
    });
  });

  it("are not read as 2D, nor 2D ones as 3D", async () => {
    const d3 = path.join(base, "d", "three.json");
    const d2 = path.join(base, "d", "two.json");
    await writeLayout(d3, { keys: ["t::a"], xy: [1, 2, 3] }, undefined, 3);
    await writeLayout(d2, { keys: ["t::a"], xy: [1, 2] });
    expect(await readLayout(d3)).toBeNull();
    expect(await readLayout(d2, 3)).toBeNull();
  });
});

describe("concurrent writes", () => {
  it("keeps every key when two saves to one file overlap", async () => {
    const file = path.join(base, "c", "graph-layout.json");
    await Promise.all([
      writeLayout(file, { keys: ["t::a"], xy: [1, 2] }),
      writeLayout(file, { keys: ["t::b"], xy: [3, 4] }),
    ]);
    expect((await readLayout(file))?.keys.sort()).toEqual(["t::a", "t::b"]);
  });

  it("reads what a save still in progress will leave", async () => {
    const file = path.join(base, "s", "graph-layout.json");
    await writeLayout(file, { keys: ["t::a"], xy: [1, 2] });
    const saving = writeLayout(file, { keys: ["t::a"], xy: [5, 6] });
    expect((await readLayoutSettled(file))?.xy).toEqual([5, 6]);
    await saving;
  });

  it("drops a save whose scope went while it waited, without recreating its directory", async () => {
    const dir = path.join(base, "roots", "gone");
    const file = path.join(dir, "graph-layout.json");
    let alive = true;
    const first = writeLayout(file, { keys: ["t::a"], xy: [1, 2] });
    const queued = writeLayout(
      file,
      { keys: ["t::b"], xy: [3, 4] },
      undefined,
      2,
      () => alive,
    );
    // The workspace is removed while the second save waits for the first.
    await first;
    alive = false;
    fs.rmSync(dir, { recursive: true, force: true });
    await queued;
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("removeWorkspaceWithLayouts", () => {
  const dir = () => path.join(base, "roots", "ws");
  const file = () => path.join(dir(), "graph-layout.json");
  const removeDir = () => {
    fs.rmSync(dir(), { recursive: true, force: true });
    return Promise.resolve();
  };

  it("waits for a save already past its check to write before removing", async () => {
    let removing: Promise<void> | undefined;
    let writtenBeforeRemove = false;
    await writeLayout(
      file(),
      { keys: ["t::a"], xy: [1, 2] },
      undefined,
      2,
      () => {
        // The removal starts just as this save passes its check.
        removing = removeWorkspaceWithLayouts(dir(), () => {
          writtenBeforeRemove = fs.existsSync(file());
          return removeDir();
        });
        return true;
      },
    );
    await removing;
    expect(writtenBeforeRemove).toBe(true);
    expect(fs.existsSync(dir())).toBe(false);
  });

  it("drops a save that reaches its write while the workspace is being removed", async () => {
    await writeLayout(file(), { keys: ["t::a"], xy: [1, 2] });
    await removeWorkspaceWithLayouts(dir(), async () => {
      // Sent while the DB is being closed: its scope still resolves, so only
      // the hold keeps it from writing the directory back after the delete.
      const late = writeLayout(file(), { keys: ["t::b"], xy: [3, 4] });
      fs.rmSync(dir(), { recursive: true, force: true });
      await late;
    });
    expect(fs.existsSync(dir())).toBe(false);
  });

  it("keeps holding saves until the last of two overlapping removals is done", async () => {
    let releaseSecond = () => {};
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const slow = removeWorkspaceWithLayouts(dir(), async () => {
      await second;
      await removeDir();
    });
    await removeWorkspaceWithLayouts(dir(), removeDir);
    // The first removal is done; the second still holds the files.
    await writeLayout(file(), { keys: ["t::a"], xy: [1, 2] });
    expect(fs.existsSync(dir())).toBe(false);
    releaseSecond();
    await slow;
  });

  it("lets a workspace registered again save as usual", async () => {
    await removeWorkspaceWithLayouts(dir(), removeDir);
    await writeLayout(file(), { keys: ["t::a"], xy: [1, 2] });
    expect((await readLayout(file()))?.keys).toEqual(["t::a"]);
  });
});
