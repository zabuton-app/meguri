import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en";
import {
  cleanSearchQuery,
  DEFAULT_SMART_COLLECTION_KEY,
  defaultQueryOf,
  loadInitialFilter,
  type SmartCollection,
  describeSearchQuery,
  hasFilterConditions,
  hasSearchConditions,
  makeSmartCollection,
  parseSmartCollections,
  saveSmartCollections,
  SMART_COLLECTIONS_KEY,
} from "@/lib/smartCollections";

const t = (key: keyof typeof en, params?: Record<string, string | number>) => {
  let s: string = en[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
};

describe("smartCollections", () => {
  it("cleanSearchQuery drops empty fields and trims text", () => {
    expect(
      cleanSearchQuery({
        q: "  hello  ",
        tags: ["a", ""],
        ratingMin: 0,
        favorite: false,
        kind: undefined,
      }),
    ).toEqual({ q: "hello", tags: ["a"] });
  });

  it("hasSearchConditions reflects cleaned query", () => {
    expect(hasSearchConditions({})).toBe(false);
    expect(hasSearchConditions({ favorite: true })).toBe(true);
  });

  it("cleanSearchQuery keeps the duplicates flag only when set", () => {
    expect(cleanSearchQuery({ duplicates: true })).toEqual({
      duplicates: true,
    });
    expect(cleanSearchQuery({ duplicates: false })).toEqual({});
  });

  it("parseSmartCollections ignores invalid JSON and schema", () => {
    expect(parseSmartCollections(null)).toEqual([]);
    expect(parseSmartCollections("{not json")).toEqual([]);
    expect(parseSmartCollections(JSON.stringify([{ id: 1 }]))).toEqual([]);
  });

  it("saveSmartCollections round-trips through localStorage", () => {
    const collection = makeSmartCollection("Favorites", { favorite: true });
    saveSmartCollections([collection]);
    const raw = localStorage.getItem(SMART_COLLECTIONS_KEY);
    expect(raw).toBeTruthy();
    expect(parseSmartCollections(raw)).toEqual([collection]);
  });

  it("describeSearchQuery builds a human-readable summary", () => {
    expect(
      describeSearchQuery(t, {
        q: "cat",
        kind: "video",
        ratingMin: 3,
        favorite: true,
      }),
    ).toContain("cat");
    expect(describeSearchQuery(t, { kind: "video" })).toContain(
      en["kind.video"],
    );
  });

  it("describeSearchQuery joins every condition in a fixed order", () => {
    // This string is also the pre-filled name in the save dialog.
    expect(
      describeSearchQuery(t, {
        ratingMin: 4,
        favorite: true,
        sort: "btime",
        sortDir: "desc",
      }),
    ).toBe("★4+ / Favorites / Created date / Descending");
  });
});

describe("hasFilterConditions", () => {
  it.each([
    { q: "beach" },
    { tags: ["a"] },
    { kind: "video" },
    { ratingMin: 3 },
    { favorite: true },
    { capturedFrom: 1 },
    { btimeTo: 1 },
    { duplicates: true },
    { played: false },
  ])("is true for %j", (query) => {
    expect(hasFilterConditions(query)).toBe(true);
  });

  it("ignores the sort, blank text and empty lists", () => {
    expect(hasFilterConditions({})).toBe(false);
    expect(hasFilterConditions({ sort: "name", sortDir: "desc" })).toBe(false);
    expect(hasFilterConditions({ q: "   ", tags: [] })).toBe(false);
  });

  it("does not count the folder as narrowing: it is where the view is", () => {
    expect(
      hasFilterConditions({ folder: { path: "a", recursive: true } }),
    ).toBe(false);
  });
});

describe("folder condition", () => {
  it("round-trips a folder through cleanSearchQuery as everything under it", () => {
    expect(
      cleanSearchQuery({ q: "x", folder: { path: "a/b", recursive: false } }),
    ).toEqual({ q: "x", folder: { path: "a/b", recursive: true } });
  });

  it("drops the root, which narrows nothing", () => {
    expect(
      cleanSearchQuery({ q: "x", folder: { path: "", recursive: true } }),
    ).toEqual({ q: "x" });
  });

  it("makes a folder alone worth saving", () => {
    expect(
      hasSearchConditions({ folder: { path: "a", recursive: true } }),
    ).toBe(true);
  });

  it("saves the workspace with a folder, so the folder can be found again", () => {
    const c = makeSmartCollection(
      "Clips",
      { kind: "video", folder: { path: "a/b", recursive: true } },
      "ws1",
    );
    expect(c.query).toEqual({
      kind: "video",
      folder: { path: "a/b", recursive: true },
    });
    expect(c.workspaceId).toBe("ws1");
    // And survives storage.
    expect(parseSmartCollections(JSON.stringify([c]))[0]).toEqual(c);
  });

  it("drops a folder that has no workspace to place it in", () => {
    const c = makeSmartCollection("Clips", {
      kind: "video",
      folder: { path: "a/b", recursive: true },
    });
    expect(c.query).toEqual({ kind: "video" });
    expect(c.workspaceId).toBeUndefined();
  });

  it("keeps no workspace for a search without a folder", () => {
    const c = makeSmartCollection("Videos", { kind: "video" }, "ws1");
    expect(c.workspaceId).toBeUndefined();
  });

  it("reads saved searches from before the workspace was stored", () => {
    const old = {
      id: "1",
      name: "Videos",
      query: { kind: "video" },
      createdAt: 1,
      updatedAt: 1,
    };
    expect(parseSmartCollections(JSON.stringify([old]))).toEqual([old]);
  });

  it("names the folder in the description", () => {
    expect(
      describeSearchQuery(t, {
        folder: { path: "a/b", recursive: true },
        kind: "video",
      }),
    ).toBe("Folder: a/b / Video");
  });
});

describe("the default saved search", () => {
  const saved: SmartCollection = {
    id: "d1",
    name: "Recent videos",
    query: {
      kind: "video",
      sort: "btime",
      folder: { path: "Movies", recursive: true },
    },
    workspaceId: "ws1",
    createdAt: 1,
    updatedAt: 1,
  };

  it("applies its conditions without the workspace-bound folder", () => {
    expect(defaultQueryOf([saved], "d1")).toEqual({
      kind: "video",
      sort: "btime",
    });
  });

  it("is absent with no default or a deleted one", () => {
    expect(defaultQueryOf([saved], null)).toBeNull();
    expect(defaultQueryOf([saved], "gone")).toBeNull();
  });

  it("is what the list starts with", () => {
    expect(loadInitialFilter()).toEqual({});
    saveSmartCollections([saved]);
    localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, "d1");
    expect(loadInitialFilter()).toEqual({ kind: "video", sort: "btime" });
  });

  it("drops a manual sort, which exists only inside a collection", () => {
    const manual = {
      ...saved,
      query: {
        kind: "video" as const,
        sort: "manual",
        sortDir: "asc" as const,
      },
    };
    expect(defaultQueryOf([manual], "d1")).toEqual({ kind: "video" });
  });
});
