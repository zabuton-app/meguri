import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { WATCH_LATER_ID, collectionTarget } from "@shared/workspaceIds";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
} from "@/ipc/types";
import {
  dropFromWatchLaterCache,
  forgetDeletedFile,
  invalidateCollectionSearches,
  GRAPH_SIZED_BY_PLAYS,
  invalidateInProgressSearches,
  invalidatePlayedSearches,
  invalidateTagSearches,
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
      resumePosition: null,
      progress: null,
    };
    qc.setQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}], {
      pages: [{ items: [row], nextCursor: null }],
      pageParams: [undefined],
    });
    qc.setQueryData<FileRow[]>(["files_random", "ws", {}], [row]);
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
      playedSince: { ws: "ws", filter: { playedFrom: 1 } },
      playedUntil: { ws: "ws", filter: { playedTo: 2 } },
      byName: { ws: "ws", filter: { sort: "name" } },
    });
    invalidatePlayedSearches(qc);
    expect(invalidated().sort()).toEqual([
      "accessed",
      "played",
      "playedSince",
      "playedUntil",
      "unplayed",
    ]);
  });

  it("invalidatePlayedSearches refreshes a graph a play can change, and only those", async () => {
    const qc = new QueryClient();
    const fetched: string[] = [];
    const graph = async (
      name: string,
      filter: object,
      byPlays: boolean,
      scope = "ws",
    ) => {
      await qc.fetchQuery({
        queryKey: ["graph_build", scope, filter],
        queryFn: () => name,
        meta: { [GRAPH_SIZED_BY_PLAYS]: byPlays },
      });
    };
    await graph("plain", {}, false);
    await graph("byPlays", { q: "x" }, true);
    await graph("played", { played: false }, false);
    await graph("accessed", { sort: "accessed" }, false);
    await graph("watchLater", {}, false, collectionTarget(WATCH_LATER_ID));
    await graph("collection", {}, false, collectionTarget("other"));
    qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "invalidate")
        fetched.push(String(e.query.state.data));
    });
    invalidatePlayedSearches(qc);
    expect(fetched.sort()).toEqual([
      "accessed",
      "byPlays",
      "played",
      "watchLater",
    ]);
  });

  it("recounts the contribution graph only where a change can reach it", async () => {
    const qc = new QueryClient();
    const counts = async (
      name: string,
      filter: SearchQuery,
      metric: string,
      scope = "ws",
    ) => {
      await qc.fetchQuery({
        queryKey: ["activity_days", scope, filter, metric, "a", "b"],
        queryFn: () => name,
      });
    };
    await counts("plays", {}, "played");
    await counts("captured", {}, "captured");
    await counts("unplayed", { played: false }, "added");
    await counts("favorites", { favorite: true }, "added");
    await counts("tagged", { tags: ["beach"] }, "added");
    await counts("inProgress", { inProgress: true }, "added");
    await counts("collection", {}, "added", collectionTarget("other"));
    let hit: string[] = [];
    qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "invalidate")
        hit.push(String(e.query.state.data));
    });
    const after = (run: () => void) => {
      hit = [];
      run();
      return [...hit].sort();
    };

    expect(after(() => invalidatePlayedSearches(qc))).toEqual([
      "plays",
      "unplayed",
    ]);
    expect(after(() => invalidateInProgressSearches(qc))).toEqual([
      "inProgress",
    ]);
    expect(after(() => invalidateTagSearches(qc))).toEqual(["tagged"]);
    expect(after(() => invalidateCollectionSearches(qc))).toEqual([
      "collection",
    ]);
    // Like the list under it, the heatmap keeps what it shows on a favorite
    // or rating edit: a recount alone would disagree with the list.
    expect(
      after(() => syncFileRowAcrossCaches(qc, "ws", 1, { favorite: 1 })),
    ).toEqual([]);
  });

  it("invalidateInProgressSearches hits the in-progress list and graph only", async () => {
    const { qc, invalidated } = seed({
      plain: { ws: "ws", filter: {} },
      inProgress: { ws: "ws", filter: { inProgress: true } },
    });
    const graphs: string[] = [];
    for (const [name, filter] of [
      ["graphPlain", {}],
      ["graphInProgress", { inProgress: true }],
    ] as const)
      await qc.fetchQuery({
        queryKey: ["graph_build", "ws", filter],
        queryFn: () => name,
      });
    qc.getQueryCache().subscribe((e) => {
      // The list entries hold page data, not a name.
      const data: unknown = e.query.state.data;
      if (
        e.type === "updated" &&
        e.action.type === "invalidate" &&
        typeof data === "string"
      )
        graphs.push(data);
    });
    invalidateInProgressSearches(qc);
    expect(invalidated()).toEqual(["inProgress"]);
    expect(graphs).toEqual(["graphInProgress"]);
  });

  it("syncFileRowAcrossCaches refreshes a graph filtered or sorted by the changed field", async () => {
    const qc = new QueryClient();
    const invalidated: string[] = [];
    for (const [name, filter] of [
      ["plain", {}],
      ["favorite", { favorite: true }],
      ["rated", { ratingMin: 3 }],
      ["byRating", { sort: "rating" }],
    ] as const)
      await qc.fetchQuery({
        queryKey: ["graph_build", "ws", filter],
        queryFn: () => name,
      });
    qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "invalidate")
        invalidated.push(String(e.query.state.data));
    });
    syncFileRowAcrossCaches(qc, "ws", 1, { favorite: 1 });
    expect(invalidated).toEqual(["favorite"]);
    invalidated.length = 0;
    syncFileRowAcrossCaches(qc, "ws", 1, { rating: 4 });
    expect(invalidated.sort()).toEqual(["byRating", "rated"]);
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

describe("forgetDeletedFile", () => {
  it("re-reads every view that lists indexed files, and only those", () => {
    const qc = new QueryClient();
    const keys = {
      search: ["files_search", "ws", {}],
      random: ["files_random", "ws"],
      folders: ["folders_list", "ws", ""],
      otherFolders: ["folders_list", "other", ""],
      history: ["history_list", "ws"],
      duplicates: ["duplicates_list", "ws"],
      tags: ["tags_list_all"],
    };
    for (const key of Object.values(keys)) qc.setQueryData(key, []);
    // Search results are paged.
    qc.setQueryData(keys.search, { pages: [], pageParams: [] });
    qc.setQueryData(["file_get", "ws", 1], null);

    forgetDeletedFile(qc, "ws", 1);

    const invalidated = Object.entries(keys)
      .filter(
        ([, key]) =>
          qc.getQueryCache().find({ queryKey: key, exact: true })?.state
            .isInvalidated,
      )
      .map(([name]) => name);
    expect(invalidated).toEqual([
      "search",
      "random",
      "folders",
      "history",
      "duplicates",
    ]);
    expect(qc.getQueryCache().find({ queryKey: ["file_get", "ws", 1] })).toBe(
      undefined,
    );
  });
});
