import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  filesSearch: vi.fn(),
  fileGet: vi.fn(),
  fileSetFavorite: vi.fn(),
  fileSetRating: vi.fn(),
  fileRecordPlay: vi.fn(),
  scanStart: vi.fn(),
  workspaceStats: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
    scanStart: (...args: unknown[]) => mocks.scanStart(...args),
    workspaceStats: () => mocks.workspaceStats(),
    tagsList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn().mockResolvedValue(undefined),
    copyFilePath: vi.fn().mockResolvedValue(undefined),
    bookmarkAdd: vi.fn().mockResolvedValue(null),
    bookmarkRemove: vi.fn().mockResolvedValue(undefined),
    thumbSetOffset: vi.fn().mockResolvedValue({ thumbOffsetSec: null }),
    fileAddTag: vi.fn().mockResolvedValue(undefined),
    fileRemoveTag: vi.fn().mockResolvedValue(undefined),
    fileDeleteFromIndex: vi.fn().mockResolvedValue({ id: 1 }),
    collectionAddFile: vi.fn().mockResolvedValue(undefined),
    collectionRemoveFile: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onThumbDone: vi.fn().mockResolvedValue(() => {}),
    onScanDone: vi.fn().mockResolvedValue(() => {}),
    onScanProgress: vi.fn().mockResolvedValue(() => {}),
    onWorkspaceChanged: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />}>
        <Route path="file/:id" element={<MediaDetail />} />
      </Route>
    </Routes>
  );
}

describe("Home + MediaDetail integration", () => {
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.fileGet.mockResolvedValue(sampleFileDetail);
    mocks.fileSetFavorite.mockResolvedValue(undefined);
    mocks.fileSetRating.mockResolvedValue(undefined);
    mocks.fileRecordPlay.mockResolvedValue(undefined);
    mocks.scanStart.mockResolvedValue(null);
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("lists files on Home and opens MediaDetail from a grid link", async () => {
    renderWithProviders(<AppRoutes />);

    await waitFor(() => {
      expect(screen.getByText("sample.mp4")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("link")[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(mocks.fileGet).toHaveBeenCalledWith(1, WS_ID);
  });

  it("toggles favorite from MediaDetail and patches react-query caches", async () => {
    const { queryClient } = renderWithProviders(<AppRoutes />, {
      route: `/file/1?ws=${WS_ID}`,
    });

    queryClient.setQueryData(["files_search", WS_ID, {}], {
      pages: [{ items: [{ ...sampleFileRow, favorite: 0 }], nextCursor: null }],
      pageParams: [undefined],
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "sample.mp4" }),
      ).toBeTruthy();
    });

    const favBtn = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Add to favorites",
    });
    fireEvent.click(favBtn);

    await waitFor(() =>
      expect(mocks.fileSetFavorite).toHaveBeenCalledWith(1, WS_ID, true),
    );

    const search = queryClient.getQueryData<{
      pages: { items: { favorite: number }[] }[];
    }>(["files_search", WS_ID, {}]);
    expect(search?.pages[0].items[0].favorite).toBe(1);
  });
});
