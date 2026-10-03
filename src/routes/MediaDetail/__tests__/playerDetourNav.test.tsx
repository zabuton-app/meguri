// Detoured to from the player, the detail view's prev/next walks what the
// player plays — browsing by folder, the folder's whole subtree — not the list,
// which shows only the folder's direct files.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import {
  MediaNavProvider,
  PlaylistNavProvider,
  type MediaNav,
} from "@/components/MediaNavContext";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  fileGet: vi.fn<(id: number, ws: string) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => Promise.resolve(defaultAppStatus),
    workspacesList: () => Promise.resolve(defaultWorkspacesList),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    filesSearch: () => Promise.resolve({ items: [], nextCursor: null }),
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    fileRecordPlay: vi.fn().mockResolvedValue(undefined),
    tagsList: vi.fn().mockResolvedValue([]),
    bookmarkAdd: vi.fn().mockResolvedValue(null),
    bookmarkRemove: vi.fn().mockResolvedValue(undefined),
    thumbSetOffset: vi.fn().mockResolvedValue({ thumbOffsetSec: null }),
    fileAddTag: vi.fn().mockResolvedValue(undefined),
    fileRemoveTag: vi.fn().mockResolvedValue(undefined),
    collectionAddFile: vi.fn().mockResolvedValue(undefined),
    collectionRemoveFile: vi.fn().mockResolvedValue(undefined),
  },
  events: { onThumbDone: vi.fn().mockResolvedValue(() => {}) },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

// A file in a subfolder: in the playlist's order, not in the list's.
const deep = { ...sampleFileRow, id: 5, relPath: "Movie/deep.mp4" };
const after = { ...sampleFileRow, id: 6, relPath: "Movie/later.mp4" };

function nav(items: (typeof sampleFileRow)[]): MediaNav {
  return {
    items,
    listOffset: 0,
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchPreviousPage: () => {},
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
  };
}

function Detail() {
  return (
    <MediaNavProvider value={nav([sampleFileRow])}>
      <PlaylistNavProvider value={nav([deep, after])}>
        <Routes>
          <Route path="file/:id" element={<MediaDetail />} />
        </Routes>
      </PlaylistNavProvider>
    </MediaNavProvider>
  );
}

describe("detail view reached from the player", () => {
  beforeEach(() => {
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      id: 5,
      relPath: "Movie/deep.mp4",
    });
  });

  it("steps through the player's order", async () => {
    renderWithProviders(<Detail />, {
      route: `/file/5?ws=${WS_ID}&from=player`,
    });
    await screen.findByRole("heading", { name: "deep.mp4" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Next file" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("keeps to the player's order after stepping off the detoured file", async () => {
    renderWithProviders(<Detail />, {
      route: `/file/5?ws=${WS_ID}&from=player`,
    });
    await screen.findByRole("heading", { name: "deep.mp4" });
    const next = screen.getByRole("button", { name: "Next file" });
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      id: 6,
      relPath: "Movie/later.mp4",
    });
    fireEvent.click(next);
    await screen.findByRole("heading", { name: "later.mp4" });
    // The player's parked pass stays behind, the order does not: the file is
    // not in the list, yet there is still a way back.
    expect(window.location.hash).not.toContain("from=player");
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Previous file" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("steps through the list when opened from it", async () => {
    renderWithProviders(<Detail />, { route: `/file/5?ws=${WS_ID}` });
    await screen.findByRole("heading", { name: "deep.mp4" });
    // Not in the list shown: nowhere to step to.
    expect(
      screen
        .getByRole("button", { name: "Next file" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
