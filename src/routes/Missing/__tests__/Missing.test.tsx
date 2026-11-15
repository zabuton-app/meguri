import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import Missing from "@/routes/Missing";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type {
  AppStatus,
  MissingFileRow,
  MissingFilesResult,
  WorkspacesList,
} from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  workspacesList: vi.fn<() => Promise<WorkspacesList>>(),
  missingFilesList: vi.fn<() => Promise<MissingFilesResult>>(),
  missingFilesPurge:
    vi.fn<
      (
        targets: { workspaceId: string; fileIds: number[] }[],
      ) => Promise<{ removed: number }>
    >(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    missingFilesList: () => mocks.missingFilesList(),
    missingFilesPurge: (
      targets: { workspaceId: string; fileIds: number[] }[],
    ) => mocks.missingFilesPurge(targets),
  },
}));

const row = (id: number, relPath: string): MissingFileRow => ({
  ...sampleFileRow,
  id,
  relPath,
  deletedAt: 1_700_000_000,
});

function MissingRoute() {
  return (
    <Routes>
      <Route path="/" element={<div data-testid="home" />} />
      <Route path="/missing" element={<Missing />} />
    </Routes>
  );
}

describe("Missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.missingFilesList.mockResolvedValue({
      items: [row(1, "videos/a.mp4"), row(2, "videos/b.mp4")],
      total: 2,
      scanning: false,
    });
    mocks.missingFilesPurge.mockResolvedValue({ removed: 1 });
  });

  it("shows the empty state when no file is missing", async () => {
    mocks.missingFilesList.mockResolvedValue({
      items: [],
      total: 0,
      scanning: false,
    });
    renderWithProviders(<MissingRoute />, { route: "/missing" });
    expect(await screen.findByText("No missing files.")).toBeTruthy();
  });

  it("says when a workspace being scanned was left out, and when the list is cut", async () => {
    mocks.missingFilesList.mockResolvedValue({
      items: [row(1, "videos/a.mp4")],
      total: 7000,
      scanning: true,
    });
    renderWithProviders(<MissingRoute />, { route: "/missing" });
    expect(
      await screen.findByText(
        "Workspaces being scanned are not listed until their scan is done.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Showing the 1 most recently missing of 7,000. Remove them to see the rest.",
      ),
    ).toBeTruthy();
  });

  it("removes only the selected files, after confirmation", async () => {
    renderWithProviders(<MissingRoute />, { route: "/missing" });
    const remove = await screen.findByRole("button", {
      name: "Remove 0 selected",
    });
    // Nothing selected, nothing to remove.
    expect((remove as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("a.mp4"));
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(mocks.missingFilesPurge).toHaveBeenCalledWith([
        { workspaceId: WS_ID, fileIds: [1] },
      ]),
    );
    // The list is read again, so what was removed drops out.
    await waitFor(() =>
      expect(mocks.missingFilesList).toHaveBeenCalledTimes(2),
    );
  });

  it("selects every file with select all", async () => {
    renderWithProviders(<MissingRoute />, { route: "/missing" });
    fireEvent.click(await screen.findByLabelText("Select all"));
    expect(
      screen.getByRole("button", { name: "Remove 2 selected" }),
    ).toBeTruthy();
  });
});
