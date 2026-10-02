// The IPC payload contract for the graph view: the query rides files_search's
// schema, and the layout cache is bounded so a renderer cannot hand main an
// arbitrary amount of data to write to disk.
import { describe, expect, it } from "vitest";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import {
  GRAPH_LAYOUT_MAX_NODES,
  GRAPH_MAX_FILES_HARD,
  GRAPH_NODE_KEY_MAX,
} from "../../../shared/ipc/graph.js";
import { MAX_WORKSPACE_ID } from "../../../shared/workspaceIds.js";

describe("graph_build payload", () => {
  it("accepts a query with and without a file cap", () => {
    expect(
      ChannelInputs.graph_build.safeParse({ query: { q: "beach" } }).success,
    ).toBe(true);
    expect(
      ChannelInputs.graph_build.safeParse({
        query: {},
        maxFiles: GRAPH_MAX_FILES_HARD,
      }).success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5, GRAPH_MAX_FILES_HARD + 1])(
    "rejects maxFiles %s",
    (maxFiles) => {
      expect(
        ChannelInputs.graph_build.safeParse({ query: {}, maxFiles }).success,
      ).toBe(false);
    },
  );

  it("rejects a malformed query", () => {
    expect(
      ChannelInputs.graph_build.safeParse({ query: { limit: 0 } }).success,
    ).toBe(false);
  });
});

describe("graph_layout_get payload", () => {
  it.each(["", "x".repeat(MAX_WORKSPACE_ID + 1)])(
    "rejects the scope %#",
    (scope) => {
      expect(ChannelInputs.graph_layout_get.safeParse({ scope }).success).toBe(
        false,
      );
    },
  );

  it("accepts a workspace, All and collection scope", () => {
    for (const scope of ["0123456789abcdef", "__all__", "collection:x"]) {
      expect(ChannelInputs.graph_layout_get.safeParse({ scope }).success).toBe(
        true,
      );
    }
  });
});

describe("graph_layout_set payload", () => {
  const ok = { scope: "__all__", keys: ["t::a", "t::b"], xy: [0, 1, 2, 3] };

  it("accepts two numbers per key", () => {
    expect(ChannelInputs.graph_layout_set.safeParse(ok).success).toBe(true);
  });

  it.each([
    ["an odd xy length", { ...ok, xy: [0, 1, 2] }],
    ["a missing pair", { ...ok, xy: [0, 1] }],
    ["NaN", { ...ok, xy: [0, NaN, 2, 3] }],
    ["Infinity", { ...ok, xy: [0, Infinity, 2, 3] }],
    ["a too-short key", { ...ok, keys: ["t:", "t::b"] }],
    [
      "a too-long key",
      { ...ok, keys: ["t::" + "x".repeat(GRAPH_NODE_KEY_MAX), "t::b"] },
    ],
    ["an empty scope", { ...ok, scope: "" }],
  ])("rejects %s", (_label, payload) => {
    expect(ChannelInputs.graph_layout_set.safeParse(payload).success).toBe(
      false,
    );
  });

  it("rejects more keys than a cache file keeps", () => {
    const n = GRAPH_LAYOUT_MAX_NODES + 1;
    const keys = Array.from({ length: n }, (_, i) => `t::${i}`);
    const xy = new Array<number>(n * 2).fill(0);
    expect(
      ChannelInputs.graph_layout_set.safeParse({ scope: "__all__", keys, xy })
        .success,
    ).toBe(false);
  });

  it("refuses an oversized array before validating its items", () => {
    const n = GRAPH_LAYOUT_MAX_NODES + 1;
    // Every key is invalid too: only the size is reported, so no item was
    // looked at.
    const keys = new Array<string>(n).fill("");
    const r = ChannelInputs.graph_layout_set.safeParse({
      scope: "__all__",
      keys,
      xy: [],
    });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths).toContain("keys");
    expect(paths.filter((p) => p.startsWith("keys."))).toEqual([]);
  });
});
