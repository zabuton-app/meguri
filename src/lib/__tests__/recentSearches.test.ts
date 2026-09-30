import { afterEach, describe, expect, it } from "vitest";
import {
  parseRecentSearches,
  pushRecentSearch,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
} from "@/lib/recentSearches";
import {
  clearRecentSearches,
  getRecentSearches,
  recordRecentSearch,
  resetRecentSearchesForTest,
} from "@/hooks/useRecentSearches";

describe("pushRecentSearch", () => {
  it("puts the newest search first", () => {
    const list = pushRecentSearch([{ q: "cat" }], { q: "dog" });
    expect(list).toEqual([{ q: "dog" }, { q: "cat" }]);
  });

  it("moves a repeated search to the front instead of keeping two", () => {
    const list = pushRecentSearch([{ q: "dog" }, { q: "cat" }], { q: "cat" });
    expect(list).toEqual([{ q: "cat" }, { q: "dog" }]);
  });

  it("treats queries that clean up to the same thing as one", () => {
    const first = pushRecentSearch([], { q: " cat ", ratingMin: 0 });
    const list = pushRecentSearch(first, { favorite: false, q: "cat" });
    expect(list).toEqual([{ q: "cat" }]);
  });

  it("keeps the same list when the newest search is repeated", () => {
    const list = [{ q: "cat" }];
    expect(pushRecentSearch(list, { q: "cat" })).toBe(list);
  });

  it("drops the oldest past the cap", () => {
    let list: ReturnType<typeof pushRecentSearch> = [];
    for (let i = 0; i < RECENT_SEARCHES_MAX + 3; i++) {
      list = pushRecentSearch(list, { q: `q${i}` });
    }
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list[0]).toEqual({ q: `q${RECENT_SEARCHES_MAX + 2}` });
    expect(list.at(-1)).toEqual({ q: "q3" });
  });

  it("ignores a query that narrows nothing", () => {
    const list = [{ q: "cat" }];
    expect(pushRecentSearch(list, {})).toBe(list);
    expect(pushRecentSearch(list, { sort: "name", sortDir: "asc" })).toBe(list);
  });

  it("leaves the folder out", () => {
    const list = pushRecentSearch([], {
      q: "cat",
      folder: { path: "trips", recursive: true },
    });
    expect(list).toEqual([{ q: "cat" }]);
  });
});

describe("parseRecentSearches", () => {
  it("returns nothing for missing or broken storage", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{")).toEqual([]);
    expect(parseRecentSearches('"nope"')).toEqual([]);
  });

  it("drops only the entries that no longer fit", () => {
    const list = parseRecentSearches(
      JSON.stringify([{ q: "cat" }, { ratingMin: "high" }, { q: "dog" }]),
    );
    expect(list).toEqual([{ q: "cat" }, { q: "dog" }]);
  });

  it("cleans, dedupes and caps what it reads, keeping the order", () => {
    const stored = [
      { q: "a" },
      { q: " a " },
      ...Array.from({ length: RECENT_SEARCHES_MAX + 2 }, (_, i) => ({
        q: `b${i}`,
      })),
    ];
    const list = parseRecentSearches(JSON.stringify(stored));
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list[0]).toEqual({ q: "a" });
    expect(list[1]).toEqual({ q: "b0" });
  });
});

describe("recent searches store", () => {
  afterEach(() => resetRecentSearchesForTest());

  it("persists recorded searches and clears them", () => {
    recordRecentSearch({ q: "cat" });
    recordRecentSearch({ tags: ["trip"] });
    expect(getRecentSearches()).toEqual([{ tags: ["trip"] }, { q: "cat" }]);
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "")).toEqual(
      [{ tags: ["trip"] }, { q: "cat" }],
    );

    // Read back from storage, as on the next launch.
    resetRecentSearchesForTest();
    expect(getRecentSearches()).toHaveLength(2);

    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBe("[]");
  });
});
