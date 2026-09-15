import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { sampleFileRow, WS_ID } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/renderWithProviders";
import { useHomeShelves } from "@/routes/Home/useHomeShelves";
import { PICKS_LIMIT, RECENT_LIMIT } from "@/routes/Home/shelves";

const mocks = vi.hoisted(() => ({
  filesSearch: vi.fn<(query: unknown) => Promise<unknown>>(),
  filesRandom: vi.fn<(query: unknown) => Promise<unknown>>(),
  historyList: vi.fn<(query: unknown) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    filesRandom: (query: unknown) => mocks.filesRandom(query),
    historyList: (query: unknown) => mocks.historyList(query),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useHomeShelves", () => {
  beforeEach(() => {
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.filesRandom.mockResolvedValue([sampleFileRow]);
    mocks.historyList.mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.filesSearch.mockReset();
    mocks.filesRandom.mockReset();
  });

  it("asks for a handful of rows per shelf, newest first", async () => {
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.recent.loaded && result.current.picks.loaded).toBe(
        true,
      ),
    );
    expect(mocks.filesSearch).toHaveBeenCalledWith({
      sort: "btime",
      sortDir: "desc",
      limit: RECENT_LIMIT,
    });
    expect(mocks.filesRandom).toHaveBeenCalledWith({ limit: PICKS_LIMIT });
    expect(result.current.recent.files).toEqual([sampleFileRow]);
    expect(result.current.picks.files).toEqual([sampleFileRow]);
  });

  it("reports an error apart from an empty shelf", async () => {
    mocks.filesRandom.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.picks.loaded).toBe(true));
    expect(result.current.picks.error).toBe(true);
    expect(result.current.picks.files).toEqual([]);
    expect(result.current.recent.error).toBe(false);
  });

  it("does nothing until enabled (the view is not active)", () => {
    renderHook(() => useHomeShelves(WS_ID, false), { wrapper });
    expect(mocks.filesSearch).not.toHaveBeenCalled();
    expect(mocks.filesRandom).not.toHaveBeenCalled();
  });

  it("reseeds the picks once the day changes, and not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 15, 23, 59, 58));
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.recent.loaded && result.current.picks.loaded).toBe(
        true,
      ),
    );
    expect(mocks.filesRandom).toHaveBeenCalledTimes(1);

    // Still the same day: nothing is drawn again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.filesRandom).toHaveBeenCalledTimes(1);

    // Midnight: a new sample.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await waitFor(() => expect(mocks.filesRandom).toHaveBeenCalledTimes(2));
    // The list of newest files is not tied to the day.
    expect(mocks.filesSearch).toHaveBeenCalledTimes(1);
  });

  it("draws a fresh sample on reshuffle", async () => {
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.recent.loaded && result.current.picks.loaded).toBe(
        true,
      ),
    );
    act(() => result.current.reshufflePicks());
    await waitFor(() => expect(mocks.filesRandom).toHaveBeenCalledTimes(2));
  });

  it("refreshes the newest files after a scan but keeps today's picks", async () => {
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.recent.loaded && result.current.picks.loaded).toBe(
        true,
      ),
    );
    act(() => result.current.refreshAfterScan());
    await waitFor(() => expect(mocks.filesSearch).toHaveBeenCalledTimes(2));
    expect(mocks.filesRandom).toHaveBeenCalledTimes(1);
  });

  it("fills an empty picks shelf after a scan", async () => {
    mocks.filesRandom.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useHomeShelves(WS_ID, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.recent.loaded && result.current.picks.loaded).toBe(
        true,
      ),
    );
    expect(result.current.picks.files).toEqual([]);
    act(() => result.current.refreshAfterScan());
    await waitFor(() =>
      expect(result.current.picks.files).toEqual([sampleFileRow]),
    );
  });
});
