import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import History from "@/routes/History";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/renderWithProviders";
import type {
  AppStatus,
  HistoryEntryRow,
  HistoryPage,
  WorkspacesList,
} from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  workspacesList: vi.fn<() => Promise<WorkspacesList>>(),
  historyList: vi.fn<(query: unknown) => Promise<HistoryPage>>(),
  historyClear: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    historyList: (query: unknown) => mocks.historyList(query),
    historyClear: () => mocks.historyClear(),
  },
}));

const entry: HistoryEntryRow = {
  ...sampleFileRow,
  historyId: 11,
  playedAt: Math.floor(Date.now() / 1000),
  via: "browser",
  position: null,
  playCount: 3,
};

function HistoryRoute() {
  return (
    <Routes>
      <Route path="/" element={<div data-testid="home" />} />
      <Route path="/history" element={<History />} />
    </Routes>
  );
}

describe("History", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.historyList.mockResolvedValue({ items: [entry], nextCursor: null });
    mocks.historyClear.mockResolvedValue(undefined);
  });

  it("renders history rows with file name and play count", async () => {
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    expect(await screen.findByText("sample.mp4")).toBeTruthy();
    // playedAt is "now" → grouped under the "today" heading (default locale is en in jsdom).
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("3 plays")).toBeTruthy();
    expect(mocks.historyList).toHaveBeenCalledWith({ cursor: 0, limit: 50 });
    // The row links to the detail route for the played file.
    const link = screen.getByText("sample.mp4").closest("a");
    expect(link?.getAttribute("href")).toContain(`/file/${sampleFileRow.id}`);
    expect(link?.getAttribute("href")).toContain(`ws=${WS_ID}`);
  });

  it("loads the next page as the end of the list comes into view", async () => {
    const day = 24 * 60 * 60;
    const today = entry.playedAt;
    mocks.historyList.mockImplementation((query) =>
      Promise.resolve(
        (query as { cursor: unknown }).cursor === 0
          ? {
              items: [
                { ...entry, historyId: 1, relPath: "a.mp4", playedAt: today },
                {
                  ...entry,
                  historyId: 2,
                  relPath: "b.mp4",
                  playedAt: today - 1,
                },
              ],
              nextCursor: { at: today - 1, id: 2, ws: WS_ID },
            }
          : {
              items: [
                {
                  ...entry,
                  historyId: 3,
                  relPath: "c.mp4",
                  playedAt: today - 2,
                },
                {
                  ...entry,
                  historyId: 4,
                  relPath: "d.mp4",
                  playedAt: today - 3 * day,
                },
              ],
              nextCursor: null,
            },
      ),
    );
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    expect(await screen.findByText("d.mp4")).toBeTruthy();
    expect(mocks.historyList).toHaveBeenCalledWith({
      cursor: { at: today - 1, id: 2, ws: WS_ID },
      limit: 50,
    });
    expect(mocks.historyList).toHaveBeenCalledTimes(2);
    // A day spread over two pages keeps one header.
    expect(screen.getAllByText("Today")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("shows the empty state when there is no history", async () => {
    mocks.historyList.mockResolvedValue({ items: [], nextCursor: null });
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    expect(await screen.findByText("No play history yet.")).toBeTruthy();
  });

  it("toggles the modal size and persists it", async () => {
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    // Default is the compact panel; the header offers the enlarge toggle.
    const toggle = await screen.findByLabelText("Enlarge modal");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Shrink modal")).toBeTruthy();
    expect(localStorage.getItem("meguri.history.modalSize")).toBe("large");
  });

  it("clears the history after confirmation", async () => {
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    fireEvent.click(await screen.findByText("Clear history"));
    // ConfirmDialog: click the destructive confirm button ("Clear").
    fireEvent.click(await screen.findByText("Clear"));
    await waitFor(() => expect(mocks.historyClear).toHaveBeenCalledTimes(1));
  });

  it("drops cached file details on clear, resume points and all", async () => {
    const queryClient = createTestQueryClient();
    // A detail view closed a moment ago: cached, with nothing reading it.
    queryClient.setQueryData(["file_get", "ws-test", 1], {
      resumePosition: 600,
    });
    renderWithProviders(<HistoryRoute />, { route: "/history", queryClient });
    fireEvent.click(await screen.findByText("Clear history"));
    fireEvent.click(await screen.findByText("Clear"));
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["file_get", "ws-test", 1]),
      ).toBeUndefined(),
    );
  });
});
