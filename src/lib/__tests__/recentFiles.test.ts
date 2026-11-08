import { afterEach, expect, it } from "vitest";
import { loadRecentView, saveRecentView, recentBasis } from "@/lib/recentFiles";
import {
  loadInitialFilter,
  makeSmartCollection,
  parseSmartCollections,
  SMART_COLLECTIONS_KEY,
  DEFAULT_SMART_COLLECTION_KEY,
} from "@/lib/smartCollections";

afterEach(() => localStorage.clear());

it("defaults to discovery date and persists either date choice and its window", () => {
  expect(recentBasis(null)).toBe("added");
  expect(loadRecentView()).toBeNull();
  for (const basis of ["added", "created"] as const) {
    saveRecentView({ period: "lastHour", basis });
    expect(loadInitialFilter().recent).toEqual({ period: "lastHour", basis });
    expect(loadInitialFilter().sortDir).toBe("desc");
  }
  saveRecentView(undefined);
  expect(loadInitialFilter()).toEqual({});
});

it("keeps a relative rule and date choice in each saved bin and gives a default bin precedence", () => {
  const bin = makeSmartCollection(
    "New this week",
    { recent: { period: "thisWeek", basis: "created" } },
    null,
    "all",
  );
  const raw = JSON.stringify([bin]);
  expect(parseSmartCollections(raw)[0].query.recent).toEqual({
    period: "thisWeek",
    basis: "created",
  });
  localStorage.setItem(SMART_COLLECTIONS_KEY, raw);
  localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, bin.id);
  saveRecentView({ period: "lastHour", basis: "added" });
  expect(loadInitialFilter().recent).toEqual({
    period: "thisWeek",
    basis: "created",
  });
});
