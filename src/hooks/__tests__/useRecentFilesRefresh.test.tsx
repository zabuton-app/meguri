import { afterEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SearchQuery } from "@/ipc/types";
import { useRecentFilesRefresh } from "../useRecentFilesRefresh";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("refreshes relative results only while visible and stops when the filter is cleared", async () => {
  vi.useFakeTimers();
  const visible = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ recent }: { recent: SearchQuery["recent"] }) =>
      useRecentFilesRefresh(recent),
    {
      wrapper,
      initialProps: { recent: { period: "lastHour", basis: "added" } },
    },
  );
  await vi.advanceTimersByTimeAsync(30000);
  expect(invalidate).toHaveBeenCalledTimes(4);
  visible.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(invalidate).toHaveBeenCalledTimes(4);
  hook.rerender({ recent: undefined });
  visible.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(invalidate).toHaveBeenCalledTimes(4);
  hook.unmount();
  qc.clear();
});
