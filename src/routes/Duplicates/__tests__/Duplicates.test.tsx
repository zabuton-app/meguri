import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import Duplicates from "@/routes/Duplicates";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type {
  AppStatus,
  DuplicatesResult,
  FileRow,
  WorkspacesList,
} from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  workspacesList: vi.fn<() => Promise<WorkspacesList>>(),
  duplicatesList: vi.fn<() => Promise<DuplicatesResult>>(),
  openFolder: vi.fn<(id: number, ws: string) => Promise<void>>(),
  copyFilePath: vi.fn<(id: number, ws: string) => Promise<void>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    duplicatesList: () => mocks.duplicatesList(),
    openFolder: (id: number, ws: string) => mocks.openFolder(id, ws),
    copyFilePath: (id: number, ws: string) => mocks.copyFilePath(id, ws),
  },
}));

function file(id: number, relPath: string, patch: Partial<FileRow> = {}) {
  return { ...sampleFileRow, id, relPath, ...patch };
}

const result: DuplicatesResult = {
  groups: [
    {
      contentHash: "aaaaaaaa1111",
      size: 2_000_000,
      files: [
        file(1, "Videos/kyoto/trip.mp4", { addedAt: 1_700_000_000 }),
        file(2, "Downloads/trip (1).mp4", { addedAt: 1_700_100_000 }),
      ],
    },
    {
      contentHash: "bbbbbbbb2222",
      size: 1_000_000,
      files: [
        file(3, "Photos/a/beach.jpg", { kind: "image" }),
        file(4, "Photos/b/beach.jpg", { kind: "image" }),
      ],
    },
  ],
  fileCount: 4,
  truncated: false,
};

function DuplicatesRoute() {
  return (
    <Routes>
      <Route path="/" element={<div data-testid="home" />} />
      <Route path="/duplicates" element={<Duplicates />} />
    </Routes>
  );
}

function detail() {
  return within(screen.getByRole("region", { name: "Group details" }));
}

describe("Duplicates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.duplicatesList.mockResolvedValue(result);
    mocks.openFolder.mockResolvedValue(undefined);
    mocks.copyFilePath.mockResolvedValue(undefined);
  });

  it("shows the first group's copies with their differences highlighted", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    expect(await screen.findByText("2 groups")).toBeTruthy();
    expect(screen.getByText("4 files")).toBeTruthy();
    expect(detail().getByRole("heading", { name: "trip.mp4" })).toBeTruthy();
    // The folders differ entirely; of the names only " (1)" does.
    expect(detail().getByText("Videos/kyoto/")).toBeTruthy();
    expect(detail().getByText("(1)")).toBeTruthy();
    // The copy indexed first carries the badge.
    expect(detail().getAllByText("Oldest")).toHaveLength(1);
  });

  it("selects a group from the list", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    fireEvent.click(await screen.findByRole("button", { name: /beach\.jpg/ }));
    expect(detail().getByRole("heading", { name: "beach.jpg" })).toBeTruthy();
    expect(detail().getByText("a/")).toBeTruthy();
    // Same added time on both copies: no single oldest one.
    expect(detail().queryByText("Oldest")).toBeNull();
  });

  it("narrows the list by kind and falls back to a visible group", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    await screen.findByText("2 groups");
    fireEvent.click(screen.getByRole("radio", { name: "Image" }));
    expect(screen.queryByRole("button", { name: /trip\.mp4/ })).toBeNull();
    expect(detail().getByRole("heading", { name: "beach.jpg" })).toBeTruthy();
  });

  it("keeps the fallback selected after the filter is cleared", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    fireEvent.click(await screen.findByRole("button", { name: /trip\.mp4/ }));
    // Hiding the selected video group falls back to the image group…
    fireEvent.click(screen.getByRole("radio", { name: "Image" }));
    expect(detail().getByRole("heading", { name: "beach.jpg" })).toBeTruthy();
    // …which stays selected once every group is listed again.
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(detail().getByRole("heading", { name: "beach.jpg" })).toBeTruthy();
  });

  it("shows a message when the filter matches nothing", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    fireEvent.change(
      await screen.findByPlaceholderText("Filter by file name or path"),
      { target: { value: "nothing-here" } },
    );
    expect(screen.getByText("No groups match the filter.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Group details" })).toBeNull();
  });

  it("reveals and copies a copy's path", async () => {
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    await screen.findByText("2 groups");
    fireEvent.click(
      detail().getAllByRole("button", { name: "Open containing folder" })[1],
    );
    fireEvent.click(
      detail().getAllByRole("button", { name: "Copy File Path" })[0],
    );
    await waitFor(() => {
      expect(mocks.openFolder).toHaveBeenCalledWith(
        2,
        sampleFileRow.workspaceId,
      );
      expect(mocks.copyFilePath).toHaveBeenCalledWith(
        1,
        sampleFileRow.workspaceId,
      );
    });
  });

  it("shows the empty state when there are no duplicates", async () => {
    mocks.duplicatesList.mockResolvedValue({
      groups: [],
      fileCount: 0,
      truncated: false,
    });
    renderWithProviders(<DuplicatesRoute />, { route: "/duplicates" });
    expect(await screen.findByText("No duplicate files found.")).toBeTruthy();
  });
});
