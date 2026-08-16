// Guards the interaction between Watch Later's auto-removal and prev/next.
// Opening a file removes it from Watch Later in the main process; if that ever
// starts refetching the list while the detail view is open, the open file drops
// out of the navigation order and prev/next dead-ends mid-session.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import { MediaNavProvider } from "@/components/MediaNavContext";
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
  fileGet: vi.fn(),
  filesSearch: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    fileRecordPlay: vi.fn().mockResolvedValue(undefined),
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
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

const second = { ...sampleFileRow, id: 2, relPath: "second.mp4" };

function DetailWithNav({ items }: { items: (typeof sampleFileRow)[] }) {
  return (
    <MediaNavProvider
      value={{
        items,
        listOffset: 0,
        fetchNextPage: () => {},
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchPreviousPage: () => {},
        hasPreviousPage: false,
        isFetchingPreviousPage: false,
      }}
    >
      <Routes>
        <Route path="file/:id" element={<MediaDetail />} />
      </Routes>
    </MediaNavProvider>
  );
}

describe("Watch Later auto-removal vs prev/next", () => {
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.fileGet.mockResolvedValue(sampleFileDetail);
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("keeps next enabled while the opened file stays in the nav order", async () => {
    renderWithProviders(<DetailWithNav items={[sampleFileRow, second]} />, {
      route: `/file/1?ws=${WS_ID}`,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });

    const next = screen.getByRole("button", { name: "Next file" });
    expect(next.hasAttribute("disabled")).toBe(false);
  });

  it("dead-ends if the opened file is dropped from the nav order", async () => {
    // The failure mode this guards against: a workspace:changed broadcast from
    // file_get refetches the list without the just-removed file, so the viewer
    // can no longer find where it is and both directions go dead.
    renderWithProviders(<DetailWithNav items={[second]} />, {
      route: `/file/1?ws=${WS_ID}`,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });

    const next = screen.getByRole("button", { name: "Next file" });
    expect(next.hasAttribute("disabled")).toBe(true);
  });
});
