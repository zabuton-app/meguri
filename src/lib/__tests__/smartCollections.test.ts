import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en";
import {
  cleanSearchQuery,
  describeSearchQuery,
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
