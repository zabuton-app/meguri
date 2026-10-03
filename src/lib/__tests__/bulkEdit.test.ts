import { describe, expect, it, vi } from "vitest";
import {
  bulkFlagOf,
  bulkTargets,
  bulkToggleTarget,
  groupBulkTargets,
  readInBulkBatches,
  uniformRating,
} from "@/lib/bulkEdit";
import { sampleFileRow } from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";
import { ChannelInputs, type BulkTargets } from "@shared/ipc/channels";
import { MAX_BULK_FILES } from "@shared/tags";

const row = (over: Partial<FileRow> = {}): FileRow => ({
  ...sampleFileRow,
  ...over,
});

describe("bulkTargets", () => {
  it("groups the selection by workspace, keeping order", () => {
    expect(
      bulkTargets([
        row({ id: 1, workspaceId: "ws-a" }),
        row({ id: 2, workspaceId: "ws-b" }),
        row({ id: 3, workspaceId: "ws-a" }),
      ]),
    ).toEqual([
      { workspaceId: "ws-a", fileIds: [1, 3] },
      { workspaceId: "ws-b", fileIds: [2] },
    ]);
  });

  it("returns nothing for an empty selection", () => {
    expect(bulkTargets([])).toEqual([]);
  });
});

describe("groupBulkTargets", () => {
  it("groups bare workspace/file pairs the same way", () => {
    expect(
      groupBulkTargets([
        { workspaceId: "ws-a", fileId: 1 },
        { workspaceId: "ws-b", fileId: 3 },
        { workspaceId: "ws-a", fileId: 2 },
      ]),
    ).toEqual([
      { workspaceId: "ws-a", fileIds: [1, 2] },
      { workspaceId: "ws-b", fileIds: [3] },
    ]);
  });
});

describe("bulkFlagOf", () => {
  const favorite = (row: FileRow) => !!row.favorite;

  it("reports all, some or none, with the counts the bar shows", () => {
    expect(
      bulkFlagOf([row({ favorite: 1 }), row({ favorite: 1 })], favorite),
    ).toEqual({ flag: "all", on: 2, total: 2 });
    expect(
      bulkFlagOf([row({ favorite: 1 }), row({ favorite: 0 })], favorite),
    ).toEqual({ flag: "some", on: 1, total: 2 });
    expect(bulkFlagOf([row({ favorite: 0 })], favorite)).toEqual({
      flag: "none",
      on: 0,
      total: 1,
    });
  });

  it("treats an empty selection as none", () => {
    expect(bulkFlagOf([], favorite)).toEqual({
      flag: "none",
      on: 0,
      total: 0,
    });
  });
});

describe("bulkToggleTarget", () => {
  it("levels a mixed selection up rather than clearing it", () => {
    // Reaching for the control means "make the selection this", so only a
    // selection that is already uniformly on turns off.
    expect(bulkToggleTarget("some")).toBe(true);
    expect(bulkToggleTarget("none")).toBe(true);
    expect(bulkToggleTarget("all")).toBe(false);
  });
});

describe("uniformRating", () => {
  it("returns the shared rating", () => {
    expect(uniformRating([row({ rating: 4 }), row({ rating: 4 })])).toBe(4);
  });

  it("returns null when the selection disagrees", () => {
    expect(uniformRating([row({ rating: 4 }), row({ rating: 2 })])).toBeNull();
  });

  it("counts an unrated selection as agreeing on zero", () => {
    expect(uniformRating([row({ rating: 0 }), row({ rating: 0 })])).toBe(0);
    expect(uniformRating([])).toBe(0);
  });
});

describe("readInBulkBatches", () => {
  const many = (n: number): FileRow[] =>
    Array.from({ length: n }, (_, i) =>
      row({ id: i + 1, workspaceId: i % 2 ? "ws-a" : "ws-b" }),
    );
  const idsIn = (targets: BulkTargets) =>
    targets.flatMap((group) => group.fileIds);
  /** Answers every target, the way main does when the files are all there. */
  const echo = (targets: BulkTargets): Promise<FileRow[]> =>
    Promise.resolve(
      targets.flatMap(({ workspaceId, fileIds }) =>
        fileIds.map((id) => row({ id, workspaceId })),
      ),
    );

  it("reads a selection within the cap in one call", async () => {
    const read = vi.fn(echo);
    const rows = await readInBulkBatches(many(MAX_BULK_FILES), read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(MAX_BULK_FILES);
  });

  it("splits a selection that has outgrown the cap into calls main accepts", async () => {
    // One file past the cap: what selecting one more while a full-size write
    // is pending leaves the following read with.
    const read = vi.fn(echo);
    const rows = await readInBulkBatches(many(MAX_BULK_FILES + 1), read);
    expect(read).toHaveBeenCalledTimes(2);
    for (const [targets] of read.mock.calls) {
      expect(ChannelInputs.files_by_ids.safeParse({ targets }).success).toBe(
        true,
      );
    }
    expect(read.mock.calls.flatMap(([targets]) => idsIn(targets))).toHaveLength(
      MAX_BULK_FILES + 1,
    );
    expect(new Set(rows.map((r) => `${r.workspaceId}:${r.id}`)).size).toBe(
      MAX_BULK_FILES + 1,
    );
  });

  it("fills each call to the cap and no further", async () => {
    const read = vi.fn(echo);
    await readInBulkBatches(many(MAX_BULK_FILES * 2), read);
    expect(read.mock.calls.map(([targets]) => idsIn(targets).length)).toEqual([
      MAX_BULK_FILES,
      MAX_BULK_FILES,
    ]);
  });

  it("fails as a whole when one of the calls fails", async () => {
    // A partial answer would read as "the rest are gone".
    const read = vi
      .fn(echo)
      .mockImplementationOnce(echo)
      .mockRejectedValueOnce(new Error("unreadable"));
    await expect(
      readInBulkBatches(many(MAX_BULK_FILES + 1), read),
    ).rejects.toThrow("unreadable");
  });

  it("asks for nothing when there is nothing to read", async () => {
    const read = vi.fn(echo);
    expect(await readInBulkBatches([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
