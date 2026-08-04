import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  FileDetail,
  FileRow,
  SearchQuery,
  SearchResult,
} from "@/ipc/types";
import {
  invalidateCollectionSearches,
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
