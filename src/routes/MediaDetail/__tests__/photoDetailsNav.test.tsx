// The photo details section in the real detail view (#725): one section per
// photo, also after stepping to the next one. It once shared its React key
// with the download origin card beside it, and React then drew it twice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  filePhotoDetails: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    filePhotoDetails: (id: number, ws: string) =>
      mocks.filePhotoDetails(id, ws),
    fileDownloadOrigin: vi.fn().mockResolvedValue([]),
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
    onThumbDone: vi.fn().mockReturnValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

const photo = (id: number, relPath: string) => ({
  ...sampleFileRow,
  id,
  relPath,
  kind: "image",
  ext: "jpg",
});
const first = photo(1, "a.jpg");
const second = photo(2, "b.jpg");
const models: Record<number, string> = { 1: "Canon EOS R5", 2: "NIKON D850" };

function DetailWithNav() {
  return (
    <MediaNavProvider
      value={{
        items: [first, second],
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

describe("photo details in the detail view", () => {
  let consoleError: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fileGet.mockImplementation((id: number) =>
      Promise.resolve({
        ...sampleFileDetail,
        ...(id === 1 ? first : second),
        meta: null,
        exif: null,
      }),
    );
    mocks.filePhotoDetails.mockImplementation((id: number) =>
      Promise.resolve({ status: "ok", details: { model: models[id] } }),
    );
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("shows one section per photo, also after stepping to the next", async () => {
    renderWithProviders(<DetailWithNav />, { route: `/file/1?ws=${WS_ID}` });
    expect(await screen.findByText("Canon EOS R5")).toBeTruthy();
    expect(screen.getAllByText("Photo details")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Next file" }));

    expect(await screen.findByText("NIKON D850")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText("Photo details")).toHaveLength(1),
    );
    expect(screen.queryByText("Canon EOS R5")).toBeNull();
    const sameKey = consoleError.mock.calls.some((args: unknown[]) =>
      String(args[0]).includes("same key"),
    );
    expect(sameKey).toBe(false);
  });
});
