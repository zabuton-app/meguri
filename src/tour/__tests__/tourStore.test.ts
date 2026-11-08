import { describe, expect, it } from "vitest";
import {
  loadSeenTours,
  markTourSeen,
  nextPendingTour,
  saveSeenTours,
} from "@/tour/tourStore";
import { FIRST_LAUNCH_TOUR_ID, type Tour } from "@/tour/tours";

const LS_KEY = "meguri.tours";
const feature = (id: string): Tour => ({ id, steps: [] });

describe("loadSeenTours", () => {
  it("treats empty storage as a first launch and records that right away", () => {
    expect([...loadSeenTours()]).toEqual([]);
    // Written back, so keys stored later in this launch do not turn the user
    // into an "existing" one next time.
    expect(localStorage.getItem(LS_KEY)).toBe("[]");
    localStorage.setItem("meguri.theme", "gruvbox-dark");
    expect(loadSeenTours().has(FIRST_LAUNCH_TOUR_ID)).toBe(false);
  });

  it("counts a user upgrading from a version without tours as having seen the first-launch tour", () => {
    localStorage.setItem("meguri.theme", "gruvbox-dark");
    expect(loadSeenTours().has(FIRST_LAUNCH_TOUR_ID)).toBe(true);
    expect(JSON.parse(localStorage.getItem(LS_KEY)!)).toEqual([
      FIRST_LAUNCH_TOUR_ID,
    ]);
  });

  it("ignores keys that are not the app's", () => {
    localStorage.setItem("something-else", "1");
    expect(loadSeenTours().has(FIRST_LAUNCH_TOUR_ID)).toBe(false);
  });

  it("reads back what was saved, dropping entries that are not ids", () => {
    localStorage.setItem(LS_KEY, JSON.stringify(["a", 1, null, "b"]));
    expect([...loadSeenTours()]).toEqual(["a", "b"]);
    saveSeenTours(new Set(["c"]));
    expect([...loadSeenTours()]).toEqual(["c"]);
  });

  it("does not show the first-launch tour again when the list is unreadable", () => {
    localStorage.setItem(LS_KEY, "{not json");
    expect(loadSeenTours().has(FIRST_LAUNCH_TOUR_ID)).toBe(true);
  });
});

describe("nextPendingTour", () => {
  const features = [feature("a"), feature("b")];

  it("starts with the first-launch tour", () => {
    expect(nextPendingTour(new Set(), features)).toBe(FIRST_LAUNCH_TOUR_ID);
  });

  it("then offers each feature tour not seen yet, oldest first", () => {
    expect(nextPendingTour(new Set([FIRST_LAUNCH_TOUR_ID]), features)).toBe(
      "a",
    );
    expect(
      nextPendingTour(new Set([FIRST_LAUNCH_TOUR_ID, "a"]), features),
    ).toBe("b");
    expect(
      nextPendingTour(new Set([FIRST_LAUNCH_TOUR_ID, "a", "b"]), features),
    ).toBeNull();
  });

  it("holds feature tours back until the first-launch tour is done", () => {
    expect(nextPendingTour(new Set(["a"]), features)).toBe(
      FIRST_LAUNCH_TOUR_ID,
    );
  });
});

describe("markTourSeen", () => {
  const features = [feature("a"), feature("b")];

  it("covers every feature tour when the first-launch tour ends", () => {
    expect([
      ...markTourSeen(new Set(), FIRST_LAUNCH_TOUR_ID, features),
    ]).toEqual([FIRST_LAUNCH_TOUR_ID, "a", "b"]);
  });

  it("marks only the feature tour itself otherwise", () => {
    const seen = new Set([FIRST_LAUNCH_TOUR_ID]);
    expect([...markTourSeen(seen, "a", features)]).toEqual([
      FIRST_LAUNCH_TOUR_ID,
      "a",
    ]);
    // The input is left alone.
    expect([...seen]).toEqual([FIRST_LAUNCH_TOUR_ID]);
  });
});
