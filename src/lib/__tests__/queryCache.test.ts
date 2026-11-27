import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { WATCH_LATER_ID, collectionTarget } from "@shared/workspaceIds";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
  WorkspacesList,
} from "@/ipc/types";
import {
  dropFromWatchLaterCache,
  forgetDeletedFile,
  invalidateCollectionSearches,
  GRAPH_SIZED_BY_PLAYS,
  invalidateInProgressSearches,
  invalidatePlayedSearches,
  invalidateTagSearches,
  patchCollectionItemOrder,
  patchFileDetailInCache,
  patchFileRowInCaches,
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
      addedAt: 1_700_000_000,
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

describe("per-content metadata reaches every copy (#716)", () => {
  const base = {
    relPath: "a.mp4",
    kind: "video",
    ext: "mp4",
    size: 100,
    width: 1920,
    height: 1080,
    duration: 60,
    favorite: 0,
    rating: 0,
    thumbStatus: "done",
    hasThumb: 1,
    capturedAt: null,
    btime: null,
    addedAt: 1_700_000_000,
    lastAccessedAt: null,
    resumePosition: null,
    progress: null,
  } satisfies Partial<FileRow>;
  const row = (
    workspaceId: string,
    id: number,
    contentHash: string | null,
  ): FileRow => ({ ...base, workspaceId, id, contentHash });
  const detailOf = (r: FileRow): FileDetail => ({
    ...r,
    absPath: `/${r.workspaceId}/${r.id}`,
    codec: null,
    fps: null,
    mtime: null,
    meta: null,
    tags: [],
    playHistory: [],
    bookmarks: [],
    thumbOffsetSec: null,
  });

  /** A list, a Discover queue and details holding three files: A, its copy
   *  B in another workspace, and C with other content. */
  function seed(hashA: string | null, hashB: string | null) {
    const qc = new QueryClient();
    const a = row("ws", 1, hashA);
    const b = row("ws-2", 7, hashB);
    const c = row("ws", 8, "other");
    qc.setQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}], {
      pages: [{ items: [a, b, c], nextCursor: null }],
      pageParams: [undefined],
    });
    qc.setQueryData<FileRow[]>(["files_random", "ws", {}], [a, b, c]);
    for (const r of [a, b, c])
      qc.setQueryData<FileDetail>(
        ["file_get", r.workspaceId, r.id],
        detailOf(r),
      );
    const listed = () =>
      qc
        .getQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}])!
        .pages[0].items.map((r) => r.favorite);
    const random = () =>
      qc
        .getQueryData<FileRow[]>(["files_random", "ws", {}])!
        .map((r) => r.favorite);
    const details = () =>
      [a, b, c].map(
        (r) =>
          qc.getQueryData<FileDetail>(["file_get", r.workspaceId, r.id])!
            .favorite,
      );
    return { qc, listed, random, details };
  }

  it("a favorite set on one copy shows on the others, and on nothing else", () => {
    const t = seed("same", "same");
    syncFileRowAcrossCaches(t.qc, "ws", 1, { favorite: 1 });
    expect(t.listed()).toEqual([1, 1, 0]);
    expect(t.random()).toEqual([1, 1, 0]);
    expect(t.details()).toEqual([1, 1, 0]);
  });

  it("a file without a content hash keeps the change to itself", () => {
    // Keyed by path: no other file shares its metadata, not even another
    // file that has no hash either.
    const t = seed(null, null);
    syncFileRowAcrossCaches(t.qc, "ws", 1, { favorite: 1 });
    expect(t.listed()).toEqual([1, 0, 0]);
    expect(t.details()).toEqual([1, 0, 0]);
  });

  it("finds the content from the detail when no list holds the file", () => {
    const t = seed("same", "same");
    // Only the detail knows file 1; the list and queue hold its copy.
    t.qc.setQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}], {
      pages: [{ items: [row("ws-2", 7, "same")], nextCursor: null }],
      pageParams: [undefined],
    });
    patchFileRowInCaches(t.qc, "ws", 1, { favorite: 1 });
    expect(
      t.qc
        .getQueryData<InfiniteData<SearchResult>>(["files_search", "ws", {}])!
        .pages[0].items.map((r) => r.favorite),
    ).toEqual([1]);
  });

  it("patches the copies' details too", () => {
    const t = seed("same", "same");
    patchFileDetailInCache(t.qc, "ws", 1, { favorite: 1 });
    expect(t.details()).toEqual([1, 1, 0]);
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

  it("recounts any heatmap of Watch Later on a play, which takes the file off it", async () => {
    const qc = new QueryClient();
    const key = (scope: string) => [
      "activity_days",
      scope,
      {},
      "added",
      "a",
      "b",
    ];
    const watchLater = collectionTarget(WATCH_LATER_ID);
    for (const scope of [watchLater, collectionTarget("other"), "ws"])
      await qc.fetchQuery({ queryKey: key(scope), queryFn: () => scope });
    invalidatePlayedSearches(qc);
    const invalidated = (scope: string) =>
      qc.getQueryCache().find({ queryKey: key(scope) })?.state.isInvalidated;
    expect(invalidated(watchLater)).toBe(true);
    expect(invalidated(collectionTarget("other"))).toBe(false);
    expect(invalidated("ws")).toBe(false);
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
      ["favDirective", { q: "is:fav" }],
      ["ratingDirective", { q: "beach rating:>=4" }],
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
    expect(invalidated.sort()).toEqual(["favDirective", "favorite"]);
    invalidated.length = 0;
    syncFileRowAcrossCaches(qc, "ws", 1, { rating: 4 });
    expect(invalidated.sort()).toEqual([
      "byRating",
      "rated",
      "ratingDirective",
    ]);
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

  it("preserves a pending invalidation after removing an entry", async () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["workspaces_list"],
      listWith([{ workspaceId: "ws", fileId: 1 }]),
    );
    await qc.invalidateQueries({
      queryKey: ["workspaces_list"],
      refetchType: "none",
    });

    dropFromWatchLaterCache(qc, "ws", 1);

    expect(itemsOf(qc)).toEqual([]);
    expect(qc.getQueryState(["workspaces_list"])?.isInvalidated).toBe(true);
  });

  it("survives an in-flight refetch landing afterwards", async () => {
    // A refetch started by some other invalidation can be in the air when a
    // play is recorded. Without the cancel, its response restores the entry
    // the main process has already consumed.
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
    // A cancelled fetch settles at once; let its response actually arrive.
    await new Promise((resolve) => setTimeout(resolve, 0));

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

describe("patchCollectionItemOrder", () => {
  const item = (fileId: number, addedAt = 0) => ({
    workspaceId: "ws",
    fileId,
    addedAt,
  });
  const listWith = (items: ReturnType<typeof item>[]): WorkspacesList => ({
    workspaces: [],
    activeId: "ws",
    collections: [
      {
        id: "collection:test",
        name: "Test",
        active: true,
        items,
        createdAt: 0,
        updatedAt: 0,
        locked: false,
      },
    ],
  });

  it("preserves a pending invalidation after patching item order", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["workspaces_list"], listWith([item(1, 10), item(2, 20)]));
    await qc.invalidateQueries({
      queryKey: ["workspaces_list"],
      refetchType: "none",
    });

    patchCollectionItemOrder(qc, "collection:test", [
      { workspaceId: "ws", fileId: 2 },
      { workspaceId: "ws", fileId: 1 },
    ]);

    expect(
      qc
        .getQueryData<WorkspacesList>(["workspaces_list"])
        ?.collections[0].items.map((item) => item.fileId),
    ).toEqual([2, 1]);
    expect(qc.getQueryState(["workspaces_list"])?.isInvalidated).toBe(true);
  });

  it("moves the loaded items within their existing collection slots", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["workspaces_list"],
      listWith([item(1, 10), item(2, 20), item(3, 30)]),
    );

    patchCollectionItemOrder(qc, "collection:test", [
      { workspaceId: "ws", fileId: 3 },
      { workspaceId: "ws", fileId: 1 },
    ]);

    expect(
      qc.getQueryData<WorkspacesList>(["workspaces_list"])?.collections[0]
        .items,
    ).toEqual([item(3, 30), item(2, 20), item(1, 10)]);
  });

  it("survives an in-flight refetch landing afterwards", async () => {
    // Main answers a workspaces_list call made before the reorder with the old
    // order. Without the cancel, that response lands after this patch, and
    // nothing re-reads the list: a reorder is not broadcast.
    const qc = new QueryClient();
    await qc.fetchQuery({
      queryKey: ["workspaces_list"],
      queryFn: () => listWith([item(1), item(2)]),
    });

    const refetch = qc.fetchQuery({
      queryKey: ["workspaces_list"],
      staleTime: 0,
      queryFn: () =>
        new Promise<WorkspacesList>((resolve) =>
          setTimeout(() => resolve(listWith([item(1), item(2)])), 0),
        ),
    });
    patchCollectionItemOrder(qc, "collection:test", [
      { workspaceId: "ws", fileId: 2 },
      { workspaceId: "ws", fileId: 1 },
    ]);
    await refetch.catch(() => {});
    // A cancelled fetch settles at once; let its response actually arrive.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      qc
        .getQueryData<WorkspacesList>(["workspaces_list"])
        ?.collections[0].items.map((item) => item.fileId),
    ).toEqual([2, 1]);
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
