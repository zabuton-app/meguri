import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/locales/en";
import { pickMessage } from "@/i18n/message";
import {
  cleanSearchQuery,
  DEFAULT_SMART_COLLECTION_KEY,
  defaultQueryOf,
  type SmartCollection,
  describeSearchQuery,
  hasFilterConditions,
  hasSearchConditions,
  makeSmartCollection,
  parseSmartCollections,
  readLegacySmartCollections,
  SMART_COLLECTIONS_KEY,
} from "@/lib/smartCollections";

const t = (key: keyof typeof en, params?: Record<string, string | number>) => {
  let s = pickMessage(en[key], new Intl.PluralRules("en"), params?.count);
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
        kinds: [],
      }),
    ).toEqual({ q: "hello", tags: ["a"] });
  });

  it("cleanSearchQuery puts kinds in one order, so the same selection is one search", () => {
    expect(cleanSearchQuery({ kinds: ["audio", "video", "audio"] })).toEqual({
      kinds: ["video", "audio"],
    });
  });

  it("cleanSearchQuery treats every kind selected as no kind filter", () => {
    expect(cleanSearchQuery({ kinds: ["image", "audio", "video"] })).toEqual(
      {},
    );
  });

  it("cleanSearchQuery keeps a kind this build does not know, after the known ones", () => {
    expect(
      cleanSearchQuery({ kinds: ["document", "image", "audio", "video"] }),
    ).toEqual({ kinds: ["video", "image", "audio", "document"] });
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

  it("cleanSearchQuery keeps the subtitles flag only when set (#378)", () => {
    expect(cleanSearchQuery({ subtitles: true })).toEqual({ subtitles: true });
    expect(cleanSearchQuery({ subtitles: false })).toEqual({});
  });

  it("parseSmartCollections ignores invalid JSON and schema", () => {
    expect(parseSmartCollections(null)).toEqual([]);
    expect(parseSmartCollections("{not json")).toEqual([]);
    expect(parseSmartCollections(JSON.stringify([{ id: 1 }]))).toEqual([]);
  });

  it("parseSmartCollections keeps the entries that validate", () => {
    const collection = makeSmartCollection("Favorites", { favorite: true });
    expect(
      parseSmartCollections(JSON.stringify([{ id: 1 }, collection])),
    ).toEqual([collection]);
  });

  it("reads what an earlier version left in localStorage", () => {
    const collection = makeSmartCollection("Favorites", { favorite: true });
    try {
      localStorage.setItem(SMART_COLLECTIONS_KEY, JSON.stringify([collection]));
      localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, collection.id);
      expect(readLegacySmartCollections()).toEqual({
        collections: [collection],
        defaultId: collection.id,
      });
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
      localStorage.removeItem(DEFAULT_SMART_COLLECTION_KEY);
    }
    expect(readLegacySmartCollections()).toEqual({
      collections: [],
      defaultId: null,
    });
  });

  it("reads nothing from localStorage that cannot be read", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      expect(readLegacySmartCollections()).toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps an ext: directive through saving and reopening (#538)", () => {
    // The directive lives in `q`, so a saved search must hand it back intact
    // for the main process to apply.
    const collection = makeSmartCollection("MP4", { q: "ext:mp4" });
    const [saved] = parseSmartCollections(JSON.stringify([collection]));
    expect(saved.query.q).toBe("ext:mp4");
  });

  it("keeps rating: and is:fav through saving and reopening (#525)", () => {
    const collection = makeSmartCollection("Best", {
      q: "rating:>=4 is:fav",
    });
    const [saved] = parseSmartCollections(JSON.stringify([collection]));
    expect(saved.query.q).toBe("rating:>=4 is:fav");
  });

  it("keeps numeric directives through saving and reopening (#524)", () => {
    const q = "size:>100mb duration:<30s";
    const collection = makeSmartCollection("Short", { q });
    const [saved] = parseSmartCollections(JSON.stringify([collection]));
    expect(saved.query.q).toBe(q);
  });

  it("describeSearchQuery builds a human-readable summary", () => {
    expect(
      describeSearchQuery(t, "en", {
        q: "cat",
        kinds: ["video"],
        ratingMin: 3,
        favorite: true,
      }),
    ).toContain("cat");
    expect(describeSearchQuery(t, "en", { kinds: ["video"] })).toContain(
      en["kind.video"],
    );
  });

  it("describeSearchQuery joins every condition in a fixed order", () => {
    // This string is also the pre-filled name in the save dialog.
    expect(
      describeSearchQuery(t, "en", {
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
    { kinds: ["video"] },
    { ratingMin: 3 },
    { favorite: true },
    { capturedFrom: 1 },
    { btimeTo: 1 },
    { duplicates: true },
    { subtitles: true },
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
      { kinds: ["video"], folder: { path: "a/b", recursive: true } },
      "ws1",
    );
    expect(c.query).toEqual({
      kinds: ["video"],
      folder: { path: "a/b", recursive: true },
    });
    expect(c.workspaceId).toBe("ws1");
    // And survives storage.
    expect(parseSmartCollections(JSON.stringify([c]))[0]).toEqual(c);
  });

  it("drops a folder that has no workspace to place it in", () => {
    const c = makeSmartCollection("Clips", {
      kinds: ["video"],
      folder: { path: "a/b", recursive: true },
    });
    expect(c.query).toEqual({ kinds: ["video"] });
    expect(c.workspaceId).toBeUndefined();
  });

  it("keeps no workspace for a search without a folder", () => {
    const c = makeSmartCollection("Videos", { kinds: ["video"] }, "ws1");
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
    // The single `kind` of that time reads as a one-kind selection.
    expect(parseSmartCollections(JSON.stringify([old]))).toEqual([
      { ...old, query: { kinds: ["video"] } },
    ]);
  });

  it("lists every selected kind in the description", () => {
    expect(describeSearchQuery(t, "en", { kinds: ["video", "audio"] })).toBe(
      `${t("kind.video")}, ${t("kind.audio")}`,
    );
  });

  it("names the folder in the description", () => {
    expect(
      describeSearchQuery(t, "en", {
        folder: { path: "a/b", recursive: true },
        kinds: ["video"],
      }),
    ).toBe("Folder: a/b / Video");
  });
});

describe("the default saved search", () => {
  const saved: SmartCollection = {
    id: "d1",
    name: "Recent videos",
    query: {
      kinds: ["video"],
      sort: "btime",
      folder: { path: "Movies", recursive: true },
    },
    workspaceId: "ws1",
    createdAt: 1,
    updatedAt: 1,
  };

  it("applies its conditions without the workspace-bound folder", () => {
    expect(defaultQueryOf([saved], "d1")).toEqual({
      kinds: ["video"],
      sort: "btime",
    });
  });

  it("is absent with no default or a deleted one", () => {
    expect(defaultQueryOf([saved], null)).toBeNull();
    expect(defaultQueryOf([saved], "gone")).toBeNull();
  });

  it("drops a manual sort, which exists only inside a collection", () => {
    const manual = {
      ...saved,
      query: {
        kinds: ["video"],
        sort: "manual",
        sortDir: "asc" as const,
      },
    };
    expect(defaultQueryOf([manual], "d1")).toEqual({ kinds: ["video"] });
  });
});
