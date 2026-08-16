import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  sampleFileRow,
  sampleTags,
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

    // Click the grid tile's link specifically (the header also contains links).
    fireEvent.click(screen.getByText("sample.mp4").closest("a")!);

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
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
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

  describe("tag chips", () => {
    beforeEach(() => {
      mocks.filesSearch.mockResolvedValue({
        items: [{ ...sampleFileRow, tags: sampleTags }],
        nextCursor: null,
      });
    });

    /** The most recent files_search query the component issued. */
    function lastQuery(): Record<string, unknown> {
      const calls = mocks.filesSearch.mock.calls;
      return calls[calls.length - 1][0] as Record<string, unknown>;
    }

    it("hides auto-meta tags from the cards but keeps manual ones", async () => {
      renderWithProviders(<AppRoutes />);
      await waitFor(() => expect(screen.getByText("beach")).toBeTruthy());
      // The metadata classifier emits several tags per file; they would crowd out
      // the manual ones in the card's single scrolling chip row.
      expect(screen.queryByText("res:")).toBeNull();
    });

    it("hides by source, not by namespace", async () => {
      mocks.filesSearch.mockResolvedValue({
        items: [
          {
            ...sampleFileRow,
            tags: [
              ...sampleTags,
              {
                id: 12,
                name: "a24",
                namespace: "studio",
                source: "auto-name",
                score: null,
              },
            ],
          },
        ],
        nextCursor: null,
      });
      renderWithProviders(<AppRoutes />);
      // A namespaced tag from a source that is not in LIST_HIDDEN_SOURCES still
      // renders — hiding is about the source's verbosity, not the namespace.
      expect(await screen.findByText("a24")).toBeTruthy();
      expect(screen.getByText("studio:")).toBeTruthy();
      expect(screen.queryByText("res:")).toBeNull();
    });

    it("puts an exact-tag directive in the search box, not the bare word", async () => {
      renderWithProviders(<AppRoutes />);
      await waitFor(() => expect(screen.getByText("beach")).toBeTruthy());

      fireEvent.click(screen.getByText("beach"));

      // The condition is exact — a bare "beach" would also hit files merely
      // named that — and it is visible in the search box, as a chip rather than
      // as raw text the user could break in half.
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
      const input = document.getElementById(
        "list-search-input",
      ) as HTMLInputElement;
      expect(
        within(input.parentElement!).getByTitle("Tags: beach"),
      ).toBeTruthy();
      expect(input.value).toBe("");
    });

    it("does not duplicate a condition when the same tag is clicked twice", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));

      // The chip re-renders once the refetch settles; clicking it again is a no-op.
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
    });

    it("points at the existing chip when the tag is already a condition", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));
      const chip = await screen.findByTitle("Tags: beach");
      expect(chip.dataset.selected).toBeUndefined();

      // A second click adds nothing, so without this it reads as a dead click.
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-slot="search-chip"]')
            ?.getAttribute("data-selected"),
        ).toBe("true"),
      );
      expect(lastQuery().q).toBe("tag:beach");
    });

    it("removes the directive as a whole from the search box", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));

      // A directive only means anything whole, so it is removed whole — one
      // click, no half-deleted `tag:bea` left behind as a substring search.
      const chip = await screen.findByTitle("Tags: beach");
      fireEvent.click(within(chip).getByRole("button"));

      await waitFor(() => expect(lastQuery().q).toBeUndefined());
    });
  });

  it("filters the library from a tag in the detail view", async () => {
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, tags: sampleTags });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    // The detail pane is the one place generated tags are visible, so it is also
    // where they can be clicked.
    fireEvent.click(await screen.findByText("4k"));

    await waitFor(() => {
      const calls = mocks.filesSearch.mock.calls;
      // The bare value: category vocabularies are disjoint, so `tag:4k` is
      // unambiguous and reads better than `tag:res:4k`.
      expect((calls[calls.length - 1][0] as Record<string, unknown>).q).toBe(
        "tag:4k",
      );
    });
    // Filtering only makes sense with the library visible, so the modal closes.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("filters by a manual tag from the detail view", async () => {
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, tags: sampleTags });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    fireEvent.click(await screen.findByText("beach"));

    await waitFor(() => {
      const last = mocks.filesSearch.mock.calls.at(-1)![0] as Record<
        string,
        unknown
      >;
      expect(last.q).toBe("tag:beach");
    });
  });

  // FR-014: the detail screen's existing collection dropdown lists all collections,
  // so the seeded Watch Later shows up there alongside user collections with no
  // extra wiring. Locked in here so a future filter can't silently drop it.
  it("lists Watch Later in the detail view's collection menu", async () => {
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [
        {
          id: "watch-later",
          name: "Watch Later",
          emoji: "🕒",
          active: false,
          items: [],
          createdAt: 0,
          updatedAt: 0,
          locked: true,
        },
      ],
    });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    fireEvent.pointerDown(await screen.findByLabelText("Add to collection"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    expect(await screen.findByText('Add to "Watch Later"')).toBeTruthy();
  });

  // Watch Later removal rides on "a play was recorded" (see consumeWatchLater in
  // electron/main.ts). Merely opening a video's detail must not record one, or
  // queueing something and peeking at its metadata would silently consume it.
  it("does not record a play when only opening a video detail", async () => {
    renderWithProviders(<AppRoutes />, {
      route: `/file/1?ws=${WS_ID}&autoplay=0`,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(mocks.fileRecordPlay).not.toHaveBeenCalled();
  });

  it("records a play when opening an image detail", async () => {
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      kind: "image",
      relPath: "photos/pic.jpg",
      ext: "jpg",
      duration: null,
    });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    await waitFor(() =>
      expect(mocks.fileRecordPlay).toHaveBeenCalledWith(1, WS_ID, "browser"),
    );
    // A single visit records exactly once despite refetches/re-renders.
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(1);
  });
});
