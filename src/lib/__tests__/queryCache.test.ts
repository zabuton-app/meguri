import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
} from "@/ipc/types";
import {
  HOME_PICKS_KEY,
  HOME_PLAYED_KEY,
  HOME_RECENT_KEY,
  dropFromWatchLaterCache,
  invalidateCollectionSearches,
  invalidatePlayHistory,
  invalidatePlayedSearches,
  invalidateTagCatalog,
  invalidateTagSearches,
  removeFileRowFromCaches,
  removeHomeShelves,
  syncFileRowAcrossCaches,
} from "@/lib/queryCache";

describe("syncFileRowAcrossCaches", () => {
  it("patches favorite/rating across search, random, and detail caches", () => {
    const qc = new QueryClient();
    const row: FileRow = {
      id: 1,
      workspaceId: "ws",
      relPath: "a.mp4",
      kind: "video",
      ext: "mp4",
      size: 100,
      width: 1920,
      height: 1080,
      duration: 60,
      favorite: 0,
      rating: 2,
      thumbStatus: "done",
      hasThumb: 1,
      capturedAt: null,
      btime: null,
      lastAccessedAt: null,
    };
    qc.setQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}], {
      pages: [{ items: [row], nextCursor: null }],
      pageParams: [undefined],
    });
    qc.setQueryData<FileRow[]>(["files_random", "ws", {}], [row]);
    qc.setQueryData<FileRow[]>([HOME_RECENT_KEY, "ws"], [row]);
    qc.setQueryData<FileRow[]>([HOME_PICKS_KEY, "ws", "2026-09-15"], [row]);
    qc.setQueryData<FileRow[]>([HOME_PLAYED_KEY, "ws"], [row]);
    qc.setQueryData<FileDetail>(["file_get", "ws", 1], {
      ...row,
      absPath: "/a.mp4",
      codec: null,
      fps: null,
      mtime: null,
      meta: null,
      tags: [],
      playHistory: [],
      bookmarks: [],
      thumbOffsetSec: null,
    });

    syncFileRowAcrossCaches(qc, "ws", 1, { favorite: 1, rating: 4 });

    const search = qc.getQueryData<InfiniteData<SearchResult>>([
      "files_search",
      "ws",
      {},
    ]);
    expect(search?.pages[0].items[0].favorite).toBe(1);
    expect(search?.pages[0].items[0].rating).toBe(4);

    const random = qc.getQueryData<FileRow[]>(["files_random", "ws", {}]);
    expect(random?.[0].favorite).toBe(1);
    expect(random?.[0].rating).toBe(4);

    const detail = qc.getQueryData<FileDetail>(["file_get", "ws", 1]);
    expect(detail?.favorite).toBe(1);
    expect(detail?.rating).toBe(4);

    // The home landing shelves hold plain rows like the discovery queue.
    for (const key of [
      [HOME_RECENT_KEY, "ws"],
      [HOME_PICKS_KEY, "ws", "2026-09-15"],
      [HOME_PLAYED_KEY, "ws"],
    ]) {
      const shelf = qc.getQueryData<FileRow[]>(key);
      expect(shelf?.[0].favorite).toBe(1);
      expect(shelf?.[0].rating).toBe(4);
    }

    removeFileRowFromCaches(qc, "ws", 1);
    expect(qc.getQueryData<FileRow[]>([HOME_RECENT_KEY, "ws"])).toEqual([]);
    expect(
      qc.getQueryData<FileRow[]>([HOME_PICKS_KEY, "ws", "2026-09-15"]),
    ).toEqual([]);
    expect(qc.getQueryData<FileRow[]>([HOME_PLAYED_KEY, "ws"])).toEqual([]);
  });

  it("removes every Home shelf when a workspace goes", () => {
    const qc = new QueryClient();
    qc.setQueryData<FileRow[]>([HOME_RECENT_KEY, "ws"], []);
    qc.setQueryData<FileRow[]>([HOME_PICKS_KEY, "ws", "2026-09-15"], []);
    qc.setQueryData<FileRow[]>([HOME_PLAYED_KEY, "ws"], []);
    qc.setQueryData<FileRow[]>(["files_random", "ws", {}], []);
    removeHomeShelves(qc);
    expect(qc.getQueryData([HOME_RECENT_KEY, "ws"])).toBeUndefined();
    expect(
      qc.getQueryData([HOME_PICKS_KEY, "ws", "2026-09-15"]),
    ).toBeUndefined();
    expect(qc.getQueryData([HOME_PLAYED_KEY, "ws"])).toBeUndefined();
    // Discovery's queue is not a Home shelf.
    expect(qc.getQueryData(["files_random", "ws", {}])).toEqual([]);
  });

  it("refreshes the played shelf with every play and with the history", () => {
    const qc = new QueryClient();
    const invalidated = (key: unknown[]) =>
      qc.getQueryCache().find({ queryKey: key })?.state.isInvalidated;
    qc.setQueryData<FileRow[]>([HOME_PLAYED_KEY, "ws"], []);
    invalidatePlayedSearches(qc);
    expect(invalidated([HOME_PLAYED_KEY, "ws"])).toBe(true);

    const qc2 = new QueryClient();
    qc2.setQueryData<FileRow[]>([HOME_PLAYED_KEY, "ws"], []);
    qc2.setQueryData(["history_list", "ws"], { pages: [], pageParams: [] });
    invalidatePlayHistory(qc2);
    for (const key of [
      [HOME_PLAYED_KEY, "ws"],
      ["history_list", "ws"],
    ])
      expect(
        qc2.getQueryCache().find({ queryKey: key })?.state.isInvalidated,
      ).toBe(true);
  });

  it("invalidateTagCatalog refreshes the newest shelf but keeps the day's picks", () => {
    // The picks are a sample meant to hold still for the day; a tag rename
    // changes nothing about which files were drawn.
    const qc = new QueryClient();
    qc.setQueryData<FileRow[]>([HOME_RECENT_KEY, "ws"], []);
    qc.setQueryData<FileRow[]>([HOME_PICKS_KEY, "ws", "2026-09-15"], []);
    qc.setQueryData<FileRow[]>(["files_random", "ws", {}], []);
    invalidateTagCatalog(qc);
    const invalidated = (key: unknown[]) =>
      qc.getQueryCache().find({ queryKey: key })?.state.isInvalidated;
    expect(invalidated([HOME_RECENT_KEY, "ws"])).toBe(true);
    expect(invalidated(["files_random", "ws", {}])).toBe(true);
    expect(invalidated([HOME_PICKS_KEY, "ws", "2026-09-15"])).toBe(false);
  });
});

describe("targeted files_search invalidation", () => {
  /** Seed one files_search cache entry per filter and report which got invalidated. */
  function seed(entries: Record<string, { ws: string; filter: SearchQuery }>): {
    qc: QueryClient;
    invalidated: () => string[];
  } {
    const qc = new QueryClient();
    for (const { ws, filter } of Object.values(entries)) {
      qc.setQueryData(["files_search", ws, filter], {
        pages: [],
        pageParams: [],
      });
    }
    const invalidated = () =>
      Object.entries(entries)
        .filter(
          ([, { ws, filter }]) =>
            qc.getQueryCache().find({ queryKey: ["files_search", ws, filter] })
              ?.state.isInvalidated,
        )
        .map(([name]) => name);
    return { qc, invalidated };
  }

  it("invalidatePlayedSearches hits played filters and accessed sorts only", () => {
    const { qc, invalidated } = seed({
      plain: { ws: "ws", filter: {} },
      played: { ws: "ws", filter: { played: true } },
      unplayed: { ws: "ws", filter: { played: false } },
      accessed: { ws: "ws", filter: { sort: "accessed" } },
      byName: { ws: "ws", filter: { sort: "name" } },
    });
    invalidatePlayedSearches(qc);
    expect(invalidated().sort()).toEqual(["accessed", "played", "unplayed"]);
  });

  it("invalidateTagSearches hits tag filters and text queries only", () => {
    const { qc, invalidated } = seed({
      plain: { ws: "ws", filter: {} },
      tagged: { ws: "ws", filter: { tags: ["cat"] } },
      emptyTags: { ws: "ws", filter: { tags: [] } },
      text: { ws: "ws", filter: { q: "beach" } },
      favorite: { ws: "ws", filter: { favorite: true } },
    });
    invalidateTagSearches(qc);
    expect(invalidated().sort()).toEqual(["tagged", "text"]);
  });

  it("invalidateCollectionSearches hits collection-scoped workspaces only", () => {
    const { qc, invalidated } = seed({
      workspace: { ws: "abc123", filter: {} },
      all: { ws: "__all__", filter: {} },
      collection: { ws: "collection:xyz", filter: {} },
    });
    invalidateCollectionSearches(qc);
    expect(invalidated()).toEqual(["collection"]);
  });
});

describe("dropFromWatchLaterCache", () => {
  const listWith = (items: { workspaceId: string; fileId: number }[]) => ({
    workspaces: [],
    activeId: "ws",
    collections: [
      {
        id: "watch-later",
        name: "Watch Later",
        active: false,
        items: items.map((i) => ({ ...i, addedAt: 0 })),
        createdAt: 0,
        updatedAt: 0,
        locked: true,
      },
    ],
  });

  const itemsOf = (qc: QueryClient) =>
    qc.getQueryData<ReturnType<typeof listWith>>(["workspaces_list"])
      ?.collections[0].items;

  it("removes the entry without refetching the query", async () => {
    const qc = new QueryClient();
    let fetches = 0;
    await qc.fetchQuery({
      queryKey: ["workspaces_list"],
      queryFn: () => {
        fetches++;
        return listWith([{ workspaceId: "ws", fileId: 1 }]);
      },
    });

    dropFromWatchLaterCache(qc, "ws", 1);

    expect(itemsOf(qc)).toEqual([]);
    expect(fetches).toBe(1);
  });

  it("survives an in-flight refetch landing afterwards", async () => {
    // The detail view mounts its own observer for this key, so a refetch is
    // routinely in the air when a play is recorded. Without the cancel, its
    // response restores the entry the main process has already consumed.
    const qc = new QueryClient();
    await qc.fetchQuery({
      queryKey: ["workspaces_list"],
      queryFn: () => listWith([{ workspaceId: "ws", fileId: 1 }]),
    });

    const refetch = qc.fetchQuery({
      queryKey: ["workspaces_list"],
      staleTime: 0,
      queryFn: () =>
        new Promise<ReturnType<typeof listWith>>((resolve) =>
          setTimeout(
            () => resolve(listWith([{ workspaceId: "ws", fileId: 1 }])),
            0,
          ),
        ),
    });
    dropFromWatchLaterCache(qc, "ws", 1);
    await refetch.catch(() => {});

    expect(itemsOf(qc)).toEqual([]);
  });

  it("leaves a first-ever load alone", async () => {
    // Cancelling reverts a query to its previous value, so cancelling a load
    // that has nothing behind it would strand this app-wide key at undefined
    // with nothing to re-run it — blanking the workspace rail and freezing
    // every Watch Later toggle in its disabled state.
    const qc = new QueryClient();
    const load = qc.fetchQuery({
      queryKey: ["workspaces_list"],
      queryFn: () =>
        new Promise<ReturnType<typeof listWith>>((resolve) =>
          setTimeout(
            () => resolve(listWith([{ workspaceId: "ws", fileId: 1 }])),
            0,
          ),
        ),
    });
    dropFromWatchLaterCache(qc, "ws", 1);
    await load;

    expect(itemsOf(qc)).toEqual([{ workspaceId: "ws", fileId: 1, addedAt: 0 }]);
    expect(qc.getQueryState(["workspaces_list"])?.status).toBe("success");
  });
});
