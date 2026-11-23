// The list beside a docked side peek: the file the peek shows is marked and
// scrolled into view once per file.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockVirtualizerScrollToIndex } from "@/test/mockVirtualizer";
import { MediaList } from "@/components/MediaList";
import { defaultWorkspacesList, sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  workspacesList: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: { workspacesList: () => mocks.workspacesList() },
  ALL_ID: "__all__",
}));

const items = [1, 2, 3, 4].map((id) => ({
  ...sampleFileRow,
  id,
  relPath: `clip-${id}.mp4`,
}));

function list(peekFileKey: string | undefined, loading = false) {
  return (
    <MediaList
      items={items}
      mediaBase="http://127.0.0.1:17345"
      workspaceId={WS_ID}
      loading={loading}
      peekFileKey={peekFileKey}
    />
  );
}

const peekedRows = () =>
  Array.from(
    document.querySelectorAll('[data-slot="media-row"][aria-current="page"]'),
  ).map((r) => r.textContent);

describe("MediaList beside a docked peek", () => {
  const scrollToIndex = mockVirtualizerScrollToIndex();

  beforeEach(() => {
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    scrollToIndex.mockClear();
  });

  it("marks the peek's file and scrolls to it once per file", async () => {
    const { rerender } = renderWithProviders(list(`${WS_ID}:3`));
    await screen.findByText("clip-3.mp4");
    expect(peekedRows()).toHaveLength(1);
    expect(peekedRows()[0]).toContain("clip-3.mp4");
    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(2, { align: "auto" }),
    );

    // Re-rendering for the same file does not scroll again.
    rerender(list(`${WS_ID}:3`));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    rerender(list(`${WS_ID}:1`));
    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "auto" }),
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
    expect(peekedRows()[0]).toContain("clip-1.mp4");

    // Closed and reopened on the same file: scrolled to again.
    rerender(list(undefined));
    expect(peekedRows()).toHaveLength(0);
    rerender(list(`${WS_ID}:1`));
    await waitFor(() => expect(scrollToIndex).toHaveBeenCalledTimes(3));
  });

  it("waits for the list to load before scrolling", async () => {
    const { rerender } = renderWithProviders(list(`${WS_ID}:4`, true));
    expect(scrollToIndex).not.toHaveBeenCalled();
    rerender(list(`${WS_ID}:4`));
    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(3, { align: "auto" }),
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("does not scroll for a file the list does not hold", async () => {
    renderWithProviders(list(`${WS_ID}:99`));
    await screen.findByText("clip-1.mp4");
    expect(peekedRows()).toHaveLength(0);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
