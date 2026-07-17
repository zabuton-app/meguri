import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import History from "@/routes/History";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
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

  it("shows the empty state when there is no history", async () => {
    mocks.historyList.mockResolvedValue({ items: [], nextCursor: null });
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    expect(await screen.findByText("No play history yet.")).toBeTruthy();
  });

  it("clears the history after confirmation", async () => {
    renderWithProviders(<HistoryRoute />, { route: "/history" });
    fireEvent.click(await screen.findByText("Clear history"));
    // ConfirmDialog: click the destructive confirm button ("Clear").
    fireEvent.click(await screen.findByText("Clear"));
    await waitFor(() => expect(mocks.historyClear).toHaveBeenCalledTimes(1));
  });
});
