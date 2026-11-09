import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SearchQuery } from "@/ipc/types";
import {
  QUERY_TEXT_SETTLE_MS,
  useSettledFilter,
} from "@/routes/Home/useSettledFilter";

describe("useSettledFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const render = (initial: SearchQuery) =>
    renderHook(({ filter }) => useSettledFilter(filter), {
      initialProps: { filter: initial },
    });

  it("holds the text back until it stops changing", () => {
    const { result, rerender } = render({ q: "a" });
    rerender({ filter: { q: "ab" } });
    act(() => {
      vi.advanceTimersByTime(QUERY_TEXT_SETTLE_MS - 1);
    });
    rerender({ filter: { q: "abc" } });
    act(() => {
      vi.advanceTimersByTime(QUERY_TEXT_SETTLE_MS - 1);
    });
    expect(result.current.q).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.q).toBe("abc");
  });

  it("takes the text at once when the rest of the filter changes with it", () => {
    // A saved search applied: its text must not wait behind its conditions.
    const { result, rerender } = render({ q: "dog" });
    rerender({ filter: { q: "cat", ratingMin: 4 } });
    expect(result.current).toEqual({ q: "cat", ratingMin: 4 });
  });

  it("keeps one object while only the text is being typed", () => {
    const { result, rerender } = render({ q: "a", kind: "video" });
    rerender({ filter: { q: "ab", kind: "video" } });
    const lagging = result.current;
    rerender({ filter: { q: "abc", kind: "video" } });
    expect(result.current).toBe(lagging);
    expect(lagging).toEqual({ q: "a", kind: "video" });
  });

  it("returns the filter itself once the text has caught up", () => {
    const first: SearchQuery = { q: "a", ratingMin: 3 };
    const { result, rerender } = render(first);
    expect(result.current).toBe(first);

    const next: SearchQuery = { q: "ab", ratingMin: 3 };
    rerender({ filter: next });
    act(() => {
      vi.advanceTimersByTime(QUERY_TEXT_SETTLE_MS);
    });
    expect(result.current).toBe(next);
  });
});
