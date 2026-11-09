// The keepWhileTyping option: the previous results stand in while only the
// search text changes, and nothing else (scope, conditions, an anchor) may
// borrow another list's rows.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchQuery } from "@/ipc/types";
import type { FilesSearchPageParam } from "@/lib/filesSearch";

type Pending = { query: SearchQuery; resolve: () => void };
const pending: Pending[] = [];

vi.mock("@/ipc/client", () => ({
  api: {
    filesSearch: (query: SearchQuery) =>
      new Promise((resolve) => {
        pending.push({
          query,
          resolve: () =>
            resolve({ items: [{ id: query.q ?? "" }], nextCursor: null }),
        });
      }),
  },
}));

const { useFilesSearch } = await import("@/hooks/useFilesSearch");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

interface Props {
  scope: string;
  filter: SearchQuery;
  anchor?: FilesSearchPageParam;
}

function setup(initial: Props) {
  pending.length = 0;
  const hook = renderHook(
    ({ scope, filter, anchor }: Props) =>
      useFilesSearch(scope, filter, true, anchor, true),
    { wrapper, initialProps: initial },
  );
  return hook;
}

const firstItem = (data: unknown) =>
  (data as { pages: { items: { id: string }[] }[] } | undefined)?.pages[0]
    ?.items[0]?.id;

async function settleFirst(hook: ReturnType<typeof setup>): Promise<void> {
  await waitFor(() => expect(pending).toHaveLength(1));
  pending[0].resolve();
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
}

describe("useFilesSearch keepWhileTyping", () => {
  it("keeps the previous results while only the text changes", async () => {
    const hook = setup({ scope: "w", filter: { q: "a" } });
    await settleFirst(hook);

    hook.rerender({ scope: "w", filter: { q: "ab" } });
    expect(hook.result.current.isPlaceholderData).toBe(true);
    expect(hook.result.current.isLoading).toBe(false);
    expect(firstItem(hook.result.current.data)).toBe("a");

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve();
    await waitFor(() => expect(firstItem(hook.result.current.data)).toBe("ab"));
    expect(hook.result.current.isPlaceholderData).toBe(false);
  });

  it("starts from loading when anything besides the text changes", async () => {
    const hook = setup({ scope: "w", filter: { q: "a" } });
    await settleFirst(hook);

    hook.rerender({ scope: "w", filter: { q: "a", kind: "video" } });
    expect(hook.result.current.isPlaceholderData).toBe(false);
    expect(hook.result.current.data).toBeUndefined();
  });

  it("starts from loading in another scope", async () => {
    const hook = setup({ scope: "w", filter: { q: "a" } });
    await settleFirst(hook);

    hook.rerender({ scope: "other", filter: { q: "ab" } });
    expect(hook.result.current.isPlaceholderData).toBe(false);
    expect(hook.result.current.data).toBeUndefined();
  });

  it("does not stand in for a window opened at an anchor", async () => {
    const hook = setup({ scope: "w", filter: { q: "a" } });
    await settleFirst(hook);

    hook.rerender({ scope: "w", filter: { q: "ab" }, anchor: 200 });
    expect(hook.result.current.isPlaceholderData).toBe(false);
    expect(hook.result.current.data).toBeUndefined();
  });
});
