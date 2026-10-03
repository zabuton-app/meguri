import { describe, expect, it, vi } from "vitest";
import type { FileRow, SearchQuery } from "@/ipc/types";
import { sampleFileRow } from "@/test/fixtures";
import { bringSomething, BRING_WEIGHTS, drawOrder } from "../petBring";

const makeFileRow = (over: Partial<FileRow>): FileRow => ({
  ...sampleFileRow,
  ...over,
});

/** An rng that replays the given rolls, then keeps returning the last one. */
function rolls(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const item = (workspaceId: string, fileId: number) => ({
  workspaceId,
  fileId,
  addedAt: 0,
});

describe("drawOrder", () => {
  it("lists every category exactly once", () => {
    const order = drawOrder(BRING_WEIGHTS, rolls(0.5));
    expect([...order].sort()).toEqual(Object.keys(BRING_WEIGHTS).sort());
  });

  it("follows the weights", () => {
    // 4 + 3 + 2 + 2 = 11: a roll just under 4/11 is still Watch Later, one
    // just over it is the next category.
    expect(drawOrder(BRING_WEIGHTS, rolls(0.36))[0]).toBe("watchLater");
    expect(drawOrder(BRING_WEIGHTS, rolls(0.37))[0]).toBe("inProgress");
    expect(drawOrder(BRING_WEIGHTS, rolls(0.99))[0]).toBe("unplayed");
  });
});

describe("bringSomething", () => {
  it("brings an unplayed Watch Later item, ignoring id look-alikes", async () => {
    const lookAlike = makeFileRow({ id: 7, workspaceId: "other" });
    const queued = makeFileRow({ id: 7, workspaceId: "ws" });
    const filesRandom = vi.fn((query: SearchQuery): Promise<FileRow[]> => {
      void query;
      return Promise.resolve([lookAlike, queued]);
    });
    const brought = await bringSomething({
      filesRandom,
      watchLater: [item("ws", 7)],
      rng: rolls(0),
    });
    expect(brought).toEqual({ category: "watchLater", file: queued });
    expect(filesRandom).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: [7], played: false }),
    );
  });

  it("searches the whole Watch Later queue, not only its first items", async () => {
    // 1,200 queued; only the last one is unplayed and in scope.
    const queue = Array.from({ length: 1200 }, (_, i) => item("ws", i + 1));
    const last = makeFileRow({ id: 1200, workspaceId: "ws" });
    const filesRandom = vi.fn((query: SearchQuery): Promise<FileRow[]> =>
      Promise.resolve(query.fileIds?.includes(1200) ? [last] : []),
    );
    const brought = await bringSomething({
      filesRandom,
      watchLater: queue,
      rng: rolls(0),
    });
    expect(brought).toEqual({ category: "watchLater", file: last });
    for (const [query] of filesRandom.mock.calls) {
      expect(query.fileIds?.length).toBeLessThanOrEqual(500);
    }
  });

  it("skips empty categories", async () => {
    const file = makeFileRow({ id: 3 });
    const filesRandom = vi.fn((query: SearchQuery): Promise<FileRow[]> =>
      Promise.resolve(query.inProgress ? [file] : []),
    );
    const brought = await bringSomething({
      filesRandom,
      watchLater: [],
      rng: rolls(0),
    });
    expect(brought).toEqual({ category: "inProgress", file });
  });

  it("looks at favorites and at highly rated files for 'liked'", async () => {
    const file = makeFileRow({ id: 9 });
    const filesRandom = vi.fn((query: SearchQuery): Promise<FileRow[]> =>
      Promise.resolve(query.ratingMin ? [file] : []),
    );
    const brought = await bringSomething({
      filesRandom,
      watchLater: [],
      // Draw "liked" first (rolls past the first two weights), favorites first.
      rng: rolls(0.7, 0.9),
    });
    expect(brought).toEqual({ category: "liked", file });
    expect(filesRandom).toHaveBeenCalledWith(
      expect.objectContaining({ favorite: true }),
    );
  });

  it("comes back empty-handed when every category is empty", async () => {
    const filesRandom = vi.fn((query: SearchQuery): Promise<FileRow[]> => {
      void query;
      return Promise.resolve([]);
    });
    await expect(
      bringSomething({ filesRandom, watchLater: [item("ws", 1)] }),
    ).resolves.toBeNull();
  });
});
