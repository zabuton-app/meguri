import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import { parkPass, peekPass } from "@/routes/Player/detour";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  sampleFileRow,
  sampleTags,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { applyTagFilter, showFolderInLibrary } from "@/lib/ui-events";
import {
  DEFAULT_SMART_COLLECTION_KEY,
  SMART_COLLECTIONS_KEY,
} from "@/lib/smartCollections";
import { useMediaNav, usePlaylistNav } from "@/components/MediaNavContext";
import { getListCounts } from "@/hooks/useListCounts";
import {
  getRecentSearches,
  resetRecentSearchesForTest,
} from "@/hooks/useRecentSearches";
import { RECENT_SEARCHES_KEY } from "@/lib/recentSearches";
import {
  BY_FOLDER_KEY,
  HEATMAP_METRIC_KEY,
  VIEW_KEY,
} from "@/routes/Home/utils";
import { addDays, daySeconds, formatDay } from "@shared/day";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  filesSearch: vi.fn(),
  activityDays: vi.fn<(input: unknown) => Promise<unknown>>(),
  fileGet: vi.fn(),
  fileSetFavorite: vi.fn(),
  fileSetRating: vi.fn(),
  fileRecordPlay: vi.fn(),
  scanStart: vi.fn(),
  workspaceStats: vi.fn(),
  foldersList: vi.fn<(ws: string, path: string) => Promise<unknown>>(),
  folderFiles: vi.fn<(ws: string, paths: string[]) => Promise<unknown>>(),
  folderOpenInFileManager:
    vi.fn<(ws: string, path: string) => Promise<unknown>>(),
  folderCopyPath: vi.fn<(ws: string, path: string) => Promise<unknown>>(),
  workspaceSwitch: vi.fn<(id: string) => Promise<unknown>>(),
}));

// Toasts are asserted on the call: no Toaster is mounted in these tests.
const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), toasts),
  Toaster: () => null,
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    activityDays: (input: unknown) => mocks.activityDays(input),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
    scanStart: (...args: unknown[]) => mocks.scanStart(...args),
    workspaceStats: () => mocks.workspaceStats(),
    foldersList: (ws: string, path: string) => mocks.foldersList(ws, path),
    folderFiles: (ws: string, paths: string[]) => mocks.folderFiles(ws, paths),
    folderOpenInFileManager: (ws: string, path: string) =>
      mocks.folderOpenInFileManager(ws, path),
    folderCopyPath: (ws: string, path: string) =>
      mocks.folderCopyPath(ws, path),
    workspaceSwitch: (id: string) => mocks.workspaceSwitch(id),
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

// The graph view needs WebGL (not in jsdom); what matters here is when Home
// shows it and what it hands over.
const graphView = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));
vi.mock("@/graph/GraphView", () => ({
  GraphView: (props: Record<string, unknown>) => {
    graphView.props = props;
    return <div data-testid="graph-view" />;
  },
}));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />}>
        <Route path="file/:id" element={<MediaDetail />} />
        <Route path="play" element={<PlaylistProbe />} />
      </Route>
    </Routes>
  );
}

/** Stands in for the player: shows the order it would play. */
function PlaylistProbe() {
  const playlist = usePlaylistNav();
  const list = useMediaNav();
  const nav = playlist ?? list;
  return (
    <div data-testid="playlist-probe">
      {playlist ? "own:" : "list:"}
      {nav?.items.map((f) => f.relPath).join(",")}
    </div>
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

    it("drops a parked playlist pass once the list becomes another one", async () => {
      renderWithProviders(<AppRoutes />);
      const tag = await screen.findByText("beach");
      // Parked on this list: it survives the list merely re-rendering.
      parkPass({
        queue: {} as Parameters<typeof parkPass>[0]["queue"],
        key: `${sampleFileRow.workspaceId}:${sampleFileRow.id}`,
        sec: 0,
      });
      expect(peekPass()).not.toBeNull();

      fireEvent.click(tag);
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
      expect(peekPass()).toBeNull();
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

  // Watch Later removal rides on "a play was recorded" (see
  // Workspaces.removeFromWatchLater in electron/core/workspaces.ts). Merely
  // opening a video's detail must not record one, or
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

describe("Home folder view", () => {
  const movie = {
    name: "Movie",
    path: "Movie",
    count: 3,
    subfolders: 1,
    previews: [sampleFileRow],
  };
  const lastSearch = () => {
    const calls = mocks.filesSearch.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  };

  afterEach(() => {
    localStorage.removeItem(VIEW_KEY);
    localStorage.removeItem(BY_FOLDER_KEY);
  });

  beforeEach(() => {
    localStorage.setItem(VIEW_KEY, "grid");
    localStorage.setItem(BY_FOLDER_KEY, "true");
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockReset();
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.foldersList.mockReset();
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      Promise.resolve({
        path,
        folders: path === "" ? [movie] : [],
        fileCount: 1,
      }),
    );
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("lists the root's folders and direct files, then walks into a folder", async () => {
    renderWithProviders(<AppRoutes />);

    await screen.findByTestId("folder-card");
    expect(lastSearch().folder).toEqual({ path: "", recursive: false });
    expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "");
    // The header says what the folder holds: one folder, one direct file.
    expect(await screen.findByText("Folders: 1 · Files: 1")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );

    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(
      within(crumbs)
        .getByRole("button", { name: 'Subfolders of "Movie"' })
        .getAttribute("aria-current"),
    ).toBe("page");

    // Back up through the breadcrumb.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Media" }));
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
  });

  it("searches everything below the folder, without its folder cards", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");

    applyTagFilter(["tag:beach"]);

    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: true }),
    );
    await waitFor(() => expect(screen.queryByTestId("folder-card")).toBeNull());
    expect(
      screen.getByRole("navigation", { name: "Folder path" }),
    ).toBeTruthy();
  });

  it("moves up when the folder shown has gone away", async () => {
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      Promise.resolve({
        path: path === "Movie" ? "" : path,
        folders: path === "" ? [movie] : [],
        fileCount: 1,
      }),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );

    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
  });

  it("draws the grid flat over All without forgetting the folder option", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    renderWithProviders(<AppRoutes />);

    await screen.findByText("sample.mp4");
    expect(lastSearch().folder).toBeUndefined();
    expect(mocks.foldersList).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Show by folder" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen
        .getByRole("button", { name: "Grid view" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("true");
  });

  it("drops a grid selection when turning on the folder option at the root", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    const name = await screen.findByText("sample.mp4");
    fireEvent.click(name.closest("a")!, { ctrlKey: true });
    expect(
      screen.getByRole("region", { name: "Selection actions" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show by folder" }));

    await screen.findByTestId("folder-card");
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).toBeNull();
  });

  it("opens the folder shown in the file manager", async () => {
    mocks.folderOpenInFileManager.mockResolvedValue(undefined);
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open in file manager" }),
    );
    expect(mocks.folderOpenInFileManager).toHaveBeenCalledWith(WS_ID, "Movie");
  });

  it("says so when the folder cannot be opened", async () => {
    mocks.folderOpenInFileManager.mockRejectedValue(
      new Error("folder not found"),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: "Open in file manager" }),
    );
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't open the folder",
        expect.objectContaining({ description: "folder not found" }),
      ),
    );
  });

  it("copies the folder's path and says so", async () => {
    mocks.folderCopyPath.mockResolvedValue(undefined);
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    expect(mocks.folderCopyPath).toHaveBeenCalledWith(WS_ID, "");
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(
        "Copied the folder path",
        expect.anything(),
      ),
    );
  });

  it("draws the list by folder too, and keeps the option across views", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    renderWithProviders(<AppRoutes />);

    // Folder rows ahead of the direct files, opened like the cards.
    await screen.findByTestId("folder-row");
    expect(lastSearch().folder).toEqual({ path: "", recursive: false });
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );

    // One option for both views: the grid opens by folder, in the same place.
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenLastCalledWith(WS_ID, "Movie"),
    );
    expect(
      screen
        .getByRole("button", { name: "Show by folder" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("toggles the option from the command menu, in the view shown", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    localStorage.setItem(BY_FOLDER_KEY, "false");
    // cmdk scrolls the highlighted option into view; jsdom has no layout.
    if (!("scrollIntoView" in Element.prototype)) {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value: () => {},
      });
    }
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    const run = async (name: string) => {
      fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
      fireEvent.click(await screen.findByRole("option", { name }));
    };

    // From the list: the list itself is drawn by folder.
    await run("Show by folder");
    await screen.findByTestId("folder-row");
    expect(localStorage.getItem(VIEW_KEY)).toBe("list");

    // Now on, the same command is named for undoing it.
    await run("Stop showing by folder");
    await waitFor(() => expect(screen.queryByTestId("folder-row")).toBeNull());
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("false");
  });

  it("reads the folder back as a chip that leaves for the root", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    // Nothing to report at the root.
    expect(screen.queryByText("Folder: Movie")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    const chip = await screen.findByText("Folder: Movie");
    fireEvent.click(
      within(chip.parentElement as HTMLElement).getByRole("button", {
        name: "Remove this filter",
      }),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
    expect(screen.queryByText("Folder: Movie")).toBeNull();
  });

  it("clears the folder with every other condition", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await screen.findByText("Folder: Movie");
    applyTagFilter(["tag:beach"]);
    await waitFor(() =>
      expect(lastSearch()).toMatchObject({
        q: "tag:beach",
        folder: { path: "Movie", recursive: true },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
    expect(lastSearch().q).toBeUndefined();
  });

  it("shows a file's folder from the detail view, turning the option on", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      relPath: "Movie/2024/sample.mp4",
    });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "More actions" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Show folder in library" }),
    );

    await waitFor(() =>
      expect(lastSearch().folder).toEqual({
        path: "Movie/2024",
        recursive: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("true");
    // Already the workspace shown: nothing to switch.
    expect(mocks.workspaceSwitch).not.toHaveBeenCalled();
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(
      within(crumbs)
        .getByRole("button", { name: 'Subfolders of "2024"' })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("switches to the file's workspace to show its folder from All", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    mocks.workspaceSwitch.mockReset();
    mocks.workspaceSwitch.mockImplementation(() => {
      mocks.appStatus.mockResolvedValue(defaultAppStatus);
      return Promise.resolve(undefined);
    });
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    showFolderInLibrary({ workspaceId: WS_ID, path: "Movie" });

    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith(WS_ID),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );
  });

  it("says so when the workspace to show cannot be switched to", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    mocks.workspaceSwitch.mockReset();
    mocks.workspaceSwitch.mockRejectedValue(new Error("gone"));
    toasts.error.mockClear();
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    localStorage.setItem(BY_FOLDER_KEY, "false");
    showFolderInLibrary({ workspaceId: "ws-other", path: "Movie" });

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't show the folder",
        expect.objectContaining({ description: "gone" }),
      ),
    );
    // Nothing changed on the way: the option stays as it was.
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("false");
  });

  it("says so, without switching, when the workspace to show is gone", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    mocks.workspaceSwitch.mockReset();
    toasts.error.mockClear();
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");
    // The rail's list is what tells a removed workspace apart.
    await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalled());

    showFolderInLibrary({ workspaceId: "ws-removed", path: "Movie" });

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't show the folder",
        expect.objectContaining({
          description: "The workspace is no longer available",
        }),
      ),
    );
    // workspace_switch would not refuse it, and would rescan the active one.
    expect(mocks.workspaceSwitch).not.toHaveBeenCalled();
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("false");
  });

  it("says so when the switch leaves another workspace active", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    mocks.workspaceSwitch.mockReset();
    // Listed, but gone by the time of the switch: All stays active.
    mocks.workspaceSwitch.mockResolvedValue(undefined);
    toasts.error.mockClear();
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    showFolderInLibrary({ workspaceId: "ws-other", path: "Movie" });

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't show the folder",
        expect.objectContaining({
          description: "The workspace is no longer available",
        }),
      ),
    );
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("false");
    expect(lastSearch().folder).toBeUndefined();
  });

  it("switches back when a later request asks for the workspace a slow switch leaves", async () => {
    let release: () => void = () => {};
    mocks.workspaceSwitch.mockReset();
    mocks.workspaceSwitch.mockImplementation((id: string) => {
      if (id === "ws-other") {
        return new Promise((resolve) => {
          release = () => {
            mocks.appStatus.mockResolvedValue({
              ...defaultAppStatus,
              workspaceId: "ws-other",
            });
            resolve(undefined);
          };
        });
      }
      mocks.appStatus.mockResolvedValue(defaultAppStatus);
      return Promise.resolve(undefined);
    });
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalled());

    // From the workspace shown: first another one (slow), then back here.
    showFolderInLibrary({ workspaceId: "ws-other", path: "Clips" });
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-other"),
    );
    showFolderInLibrary({ workspaceId: WS_ID, path: "Movie" });
    release();

    // The later request waits the switch out, then switches back.
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenLastCalledWith(WS_ID),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );
  });

  it("drops a pending request once the user has moved on", async () => {
    let release: () => void = () => {};
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      path === "Deep"
        ? new Promise((resolve) => {
            release = () => resolve({ path, folders: [], fileCount: 1 });
          })
        : Promise.resolve({
            path,
            folders: path === "" ? [movie] : [],
            fileCount: 1,
          }),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");

    showFolderInLibrary({ workspaceId: WS_ID, path: "Deep" });
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Deep"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );
    release();

    await new Promise((r) => setTimeout(r, 50));
    expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false });
  });

  it("finishes a switch the user moved on from in the workspace being left", async () => {
    let release: () => void = () => {};
    mocks.workspaceSwitch.mockReset();
    mocks.workspaceSwitch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            mocks.appStatus.mockResolvedValue({
              ...defaultAppStatus,
              workspaceId: "ws-other",
            });
            resolve(undefined);
          };
        }),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalled());

    showFolderInLibrary({ workspaceId: "ws-other", path: "Clips" });
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-other"),
    );
    // A move in the workspace being left, while the switch is under way.
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    release();

    // The switch cannot be taken back, so the request finishes where it went
    // rather than leaving ws-other active at its root.
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith("ws-other", "Clips"),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Clips", recursive: false }),
    );
  });

  it("goes nowhere when the folder to open cannot be resolved", async () => {
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      path === "Movie/Old"
        ? Promise.reject(new Error("worker down"))
        : Promise.resolve({
            path,
            folders: path === "" ? [movie] : [],
            fileCount: 1,
          }),
    );
    toasts.error.mockClear();
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Old videos",
          query: {
            kind: "video",
            folder: { path: "Movie/Old", recursive: true },
          },
          workspaceId: WS_ID,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("folder-card");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Old videos/ }),
      );

      // With a condition on, the view would only search the missing folder
      // and never list it — so it is not gone to at all.
      await waitFor(() =>
        expect(toasts.error).toHaveBeenCalledWith(
          "Couldn't show the folder",
          expect.objectContaining({ description: "worker down" }),
        ),
      );
      expect(
        mocks.filesSearch.mock.calls.some(
          ([q]) =>
            (q as { folder?: { path: string } }).folder?.path === "Movie/Old",
        ),
      ).toBe(false);
      expect(screen.queryByText("Folder: Movie/Old")).toBeNull();
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("returns to the root for a saved search without a folder, even with the option off", async () => {
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Videos",
          query: { kind: "video" },
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("folder-card");
      fireEvent.click(
        screen.getByRole("button", { name: 'Open folder "Movie"' }),
      );
      await screen.findByText("Folder: Movie");
      fireEvent.click(screen.getByRole("button", { name: "Show by folder" }));
      await waitFor(() => expect(lastSearch().folder).toBeUndefined());

      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: /^Videos/ }));
      await waitFor(() => expect(lastSearch().kind).toBe("video"));

      // Turning the option back on opens at the root, not at Movie.
      fireEvent.click(screen.getByRole("button", { name: "Show by folder" }));
      await waitFor(() =>
        expect(lastSearch().folder).toEqual({ path: "", recursive: true }),
      );
      expect(screen.queryByText("Folder: Movie")).toBeNull();
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("opens on the default saved search, without its folder", async () => {
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Rated old videos",
          query: {
            kind: "video",
            sort: "rating",
            folder: { path: "Movie/Old", recursive: true },
          },
          workspaceId: WS_ID,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, "1");
    renderWithProviders(<AppRoutes />);
    await waitFor(() =>
      expect(lastSearch()).toMatchObject({ kind: "video", sort: "rating" }),
    );
    expect(
      mocks.filesSearch.mock.calls.some(
        ([q]) =>
          (q as { folder?: { path: string } }).folder?.path === "Movie/Old",
      ),
    ).toBe(false);
  });

  it("does not count the search it opens on as a recent one", async () => {
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Videos",
          query: { kind: "video" },
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, "1");
    resetRecentSearchesForTest();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<AppRoutes />);
      await waitFor(() =>
        expect(lastSearch()).toMatchObject({ kind: "video" }),
      );
      // Past the time a search takes to count as one.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(getRecentSearches()).toEqual([]);
    } finally {
      vi.useRealTimers();
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
      localStorage.removeItem(DEFAULT_SMART_COLLECTION_KEY);
      localStorage.removeItem(RECENT_SEARCHES_KEY);
      resetRecentSearchesForTest();
    }
  });

  it("opens a saved search whose folder is gone at its nearest ancestor", async () => {
    // Movie/Old was removed after the search was saved; with a condition on,
    // the view only searches, so the folder is resolved when it is opened.
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      Promise.resolve({
        path: path === "Movie/Old" ? "Movie" : path,
        folders: path === "" ? [movie] : [],
        fileCount: 1,
      }),
    );
    toasts.info.mockClear();
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Old videos",
          query: {
            kind: "video",
            folder: { path: "Movie/Old", recursive: true },
          },
          workspaceId: WS_ID,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("folder-card");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Old videos/ }),
      );

      await waitFor(() =>
        expect(lastSearch()).toMatchObject({
          kind: "video",
          folder: { path: "Movie", recursive: true },
        }),
      );
      expect(toasts.info).toHaveBeenCalledWith(
        "The folder you were viewing is gone, so you were moved up.",
        expect.anything(),
      );
      expect(
        mocks.filesSearch.mock.calls.some(
          ([q]) =>
            (q as { folder?: { path: string } }).folder?.path === "Movie/Old",
        ),
      ).toBe(false);
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("lets only the latest of two folder requests land", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    let finishSwitch: () => void = () => {};
    mocks.workspaceSwitch.mockReset();
    mocks.workspaceSwitch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSwitch = () => {
            mocks.appStatus.mockResolvedValue(defaultAppStatus);
            resolve(undefined);
          };
        }),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    // The first waits on a slow switch; the second is asked for meanwhile.
    showFolderInLibrary({ workspaceId: WS_ID, path: "Movie" });
    const first = finishSwitch;
    showFolderInLibrary({ workspaceId: WS_ID, path: "Photos" });
    finishSwitch();
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Photos", recursive: false }),
    );
    first();
    // The earlier request, finishing last, does not pull the view back.
    await new Promise((r) => setTimeout(r, 50));
    expect(lastSearch().folder).toEqual({ path: "Photos", recursive: false });
  });

  it("opens a saved search without a folder at the root", async () => {
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Videos",
          query: { kind: "video" },
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("folder-card");
      fireEvent.click(
        screen.getByRole("button", { name: 'Open folder "Movie"' }),
      );
      await screen.findByText("Folder: Movie");

      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: /^Videos/ }));

      // Every condition is replaced, the folder included.
      await waitFor(() =>
        expect(lastSearch()).toMatchObject({
          kind: "video",
          folder: { path: "", recursive: true },
        }),
      );
      expect(screen.queryByText("Folder: Movie")).toBeNull();
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("opens a saved search at its folder", async () => {
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Movie videos",
          query: { kind: "video", folder: { path: "Movie", recursive: true } },
          workspaceId: WS_ID,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("folder-card");

      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Movie videos/ }),
      );

      await waitFor(() =>
        expect(lastSearch()).toMatchObject({
          kind: "video",
          folder: { path: "Movie", recursive: true },
        }),
      );
      expect(await screen.findByText("Folder: Movie")).toBeTruthy();
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("opens Discovery scoped to the folder shown", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    const discover = () =>
      screen.getByRole("link", { name: "Discovery" }).getAttribute("href") ??
      "";
    // At the root the pool is the whole workspace; the root is named anyway
    // so Discovery can say which folder it draws from.
    expect(decodeURIComponent(discover())).toContain(
      '"folder":{"path":"","recursive":true}',
    );

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(decodeURIComponent(discover())).toContain(
        '"folder":{"path":"Movie","recursive":true}',
      ),
    );
  });

  it("publishes what the view shows for the status bar", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    // Browsing: the folder's own files and folders (the mocked listing has
    // one direct file and one child folder at the root).
    await waitFor(() =>
      expect(getListCounts()).toEqual({ files: 1, more: false, folders: 1 }),
    );

    // Searching inside it: the files loaded so far, no folders.
    applyTagFilter(["tag:beach"]);
    await waitFor(() =>
      expect(getListCounts()).toEqual({ files: 1, more: false, folders: null }),
    );
  });

  it("leaves the count to the total when nothing narrows a flat view", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");
    await waitFor(() =>
      expect(getListCounts()).toEqual({
        files: null,
        more: false,
        folders: null,
      }),
    );
  });

  const fab = (name: string) =>
    screen.getByRole("link", { name }).getAttribute("aria-disabled");

  it("enables both buttons for a folder of folders, playing the whole folder", async () => {
    // The root holds no files of its own, only a folder with three.
    mocks.filesSearch.mockImplementation((query: unknown) =>
      Promise.resolve({
        // The playlist's order is the root's whole subtree, by name. The list
        // itself asks for the root's direct files (not recursive).
        items: (query as { folder?: { recursive?: boolean } }).folder?.recursive
          ? [
              { ...sampleFileRow, id: 7, relPath: "Movie/a.mp4" },
              { ...sampleFileRow, id: 8, relPath: "Movie/b.mp4" },
            ]
          : [],
        nextCursor: null,
      }),
    );
    mocks.foldersList.mockResolvedValue({
      path: "",
      folders: [movie],
      fileCount: 0,
    });
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    await waitFor(() => expect(fab("Play as playlist")).toBe("false"));
    expect(fab("Discovery")).toBe("false");

    fireEvent.click(screen.getByRole("link", { name: "Play as playlist" }));
    await waitFor(() =>
      expect(screen.getByTestId("playlist-probe").textContent).toBe(
        "own:Movie/a.mp4,Movie/b.mp4",
      ),
    );
    expect(lastSearch()).toMatchObject({
      folder: { path: "", recursive: true },
      sort: "name",
      sortDir: "asc",
    });
  });

  it("disables both buttons when there is nothing to draw from", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(mocks.filesSearch).toHaveBeenCalled());
    await waitFor(() => expect(fab("Play as playlist")).toBe("true"));
    expect(fab("Discovery")).toBe("true");
  });

  it("plays the list as shown when not browsing by folder", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />, { route: "/play" });
    await waitFor(() =>
      expect(screen.getByTestId("playlist-probe").textContent).toBe(
        "list:videos/sample.mp4",
      ),
    );
  });
});

describe("Home graph view", () => {
  afterEach(() => {
    localStorage.removeItem(VIEW_KEY);
    localStorage.removeItem(BY_FOLDER_KEY);
  });

  beforeEach(() => {
    graphView.props = null;
    localStorage.setItem(VIEW_KEY, "grid");
    localStorage.setItem(BY_FOLDER_KEY, "true");
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockReset();
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.foldersList.mockReset();
    mocks.foldersList.mockResolvedValue({
      path: "",
      folders: [],
      fileCount: 1,
    });
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("leaves the graph for a saved search that carries a folder", async () => {
    // The graph has no folder form: applied there, the folder would be dropped
    // and the graph would show the whole workspace under the search's name.
    localStorage.setItem(VIEW_KEY, "graph");
    localStorage.setItem(
      SMART_COLLECTIONS_KEY,
      JSON.stringify([
        {
          id: "1",
          name: "Movie videos",
          query: { kind: "video", folder: { path: "Movie", recursive: true } },
          workspaceId: WS_ID,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    mocks.foldersList.mockResolvedValue({
      path: "Movie",
      folders: [],
      fileCount: 1,
    });
    try {
      renderWithProviders(<AppRoutes />);
      await screen.findByTestId("graph-view");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Smart collections" }),
        { button: 0, ctrlKey: false },
      );
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Movie videos/ }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("graph-view")).toBeNull(),
      );
      expect(localStorage.getItem(VIEW_KEY)).toBe("grid");
      await waitFor(() =>
        expect(mocks.filesSearch.mock.calls.at(-1)?.[0]).toMatchObject({
          kind: "video",
          folder: { path: "Movie", recursive: true },
        }),
      );
    } finally {
      localStorage.removeItem(SMART_COLLECTIONS_KEY);
    }
  });

  it("swaps the list for the graph, off the folder view, and back", async () => {
    renderWithProviders(<AppRoutes />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Show by folder" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Graph view" }));
    await screen.findByTestId("graph-view");
    expect(screen.queryByTestId("folder-card")).toBeNull();
    expect(graphView.props?.scope).toBe(WS_ID);
    expect(localStorage.getItem(VIEW_KEY)).toBe("graph");
    const disabled = screen.getByRole("button", { name: "Show by folder" });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    expect(disabled.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await waitFor(() => expect(screen.queryByTestId("graph-view")).toBeNull());
    // The stored choice waited for the list views.
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Show by folder" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("Home heatmap", () => {
  // A day the heatmap always shows, whatever today is.
  const date = addDays(new Date(), -1);
  const yesterday = formatDay(date);
  const [start, end] = daySeconds(date);
  const shown = date.toLocaleDateString();

  /** The most recent files_search query the component issued. */
  function lastQuery(): Record<string, unknown> {
    const calls = mocks.filesSearch.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  }

  function cell(day: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!el) throw new Error(`no cell for ${day}`);
    return el;
  }

  const chips = () => [
    ...document.querySelectorAll<HTMLElement>('[data-slot="filter-chip"]'),
  ];
  const chipLabels = () => chips().map((c) => c.textContent);

  afterEach(() => {
    localStorage.removeItem(VIEW_KEY);
    localStorage.removeItem(BY_FOLDER_KEY);
    localStorage.removeItem(HEATMAP_METRIC_KEY);
  });

  beforeEach(() => {
    localStorage.setItem(VIEW_KEY, "heatmap");
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockReset();
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.activityDays.mockReset();
    mocks.activityDays.mockResolvedValue({
      days: [{ date: yesterday, count: 3 }],
    });
    mocks.foldersList.mockReset();
    mocks.foldersList.mockResolvedValue({
      path: "",
      folders: [],
      fileCount: 1,
    });
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("picks a day as the filter's date range for the metric, and lets it go", async () => {
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(cell(yesterday).dataset.level).toBe("4"));
    await waitFor(() => expect(screen.getByText("sample.mp4")).toBeTruthy());
    expect(lastQuery().playedFrom).toBeUndefined();
    expect(getListCounts()).toMatchObject({ files: null });
    expect(chipLabels()).toEqual([]);

    fireEvent.click(cell(yesterday));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ playedFrom: start, playedTo: end }),
    );
    // The same condition the filter bar offers: one chip, and the panel's
    // inputs hold the day.
    expect(chipLabels()).toEqual([`Played date: ${shown}`]);
    fireEvent.click(
      document.querySelector('[data-slot="more-filters-trigger"]')!,
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Played date: From").value,
    ).toBe(yesterday);
    expect(
      screen.getByLabelText<HTMLInputElement>("Played date: To").value,
    ).toBe(yesterday);
    // The status bar counts the day's files, not the whole workspace.
    await waitFor(() => expect(getListCounts()).toMatchObject({ files: 1 }));
    // The heatmap counts without its own range: every day keeps its count.
    for (const [input] of mocks.activityDays.mock.calls)
      expect((input as { query: object }).query).toEqual({});

    fireEvent.click(cell(yesterday));
    await waitFor(() => expect(lastQuery().playedFrom).toBeUndefined());
    expect(lastQuery().playedTo).toBeUndefined();
    expect(chipLabels()).toEqual([]);
  });

  it("marks the day set from the filter bar, and follows its chip", async () => {
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(cell(yesterday).dataset.level).toBe("4"));
    fireEvent.click(
      document.querySelector('[data-slot="more-filters-trigger"]')!,
    );
    fireEvent.change(screen.getByLabelText("Played date: From"), {
      target: { value: yesterday },
    });
    fireEvent.change(screen.getByLabelText("Played date: To"), {
      target: { value: yesterday },
    });
    await waitFor(() =>
      expect(cell(yesterday).getAttribute("aria-pressed")).toBe("true"),
    );

    // Another condition keeps the day; the heatmap counts with it.
    applyTagFilter(["tag:beach"]);
    await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
    expect(lastQuery()).toMatchObject({ playedFrom: start });
    await waitFor(() =>
      expect(
        mocks.activityDays.mock.calls.some(
          ([input]) =>
            JSON.stringify((input as { query: object }).query) ===
            JSON.stringify({ q: "tag:beach" }),
        ),
      ).toBe(true),
    );

    const chip = chips().find((c) => c.textContent?.startsWith("Played date"))!;
    fireEvent.click(within(chip).getByRole("button"));
    await waitFor(() => expect(lastQuery().playedFrom).toBeUndefined());
    expect(lastQuery().q).toBe("tag:beach");
    expect(cell(yesterday).getAttribute("aria-pressed")).toBe("false");
  });

  it("drops the day picked when the metric changes, and remembers the metric", async () => {
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(cell(yesterday).dataset.level).toBe("4"));
    fireEvent.click(cell(yesterday));
    await waitFor(() => expect(lastQuery().playedFrom).toBe(start));

    // Choosing the metric already shown keeps the day.
    fireEvent.click(screen.getByRole("radio", { name: "Played" }));
    expect(lastQuery().playedFrom).toBe(start);

    fireEvent.click(screen.getByRole("radio", { name: "Added" }));
    await waitFor(() => expect(lastQuery().playedFrom).toBeUndefined());
    await waitFor(() =>
      expect(
        mocks.activityDays.mock.calls.some(
          ([input]) => (input as { metric: string }).metric === "added",
        ),
      ).toBe(true),
    );
    expect(localStorage.getItem(HEATMAP_METRIC_KEY)).toBe("added");

    // The day picked now is the new metric's range.
    fireEvent.click(cell(yesterday));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ addedFrom: start, addedTo: end }),
    );
    expect(chipLabels()).toEqual([`Added date: ${shown}`]);
  });

  it("keeps the day as a condition of the list in the other views", async () => {
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(cell(yesterday).dataset.level).toBe("4"));
    fireEvent.click(cell(yesterday));
    await waitFor(() => expect(lastQuery().playedFrom).toBe(start));

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    await waitFor(() =>
      expect(document.querySelector("[data-day]")).toBeNull(),
    );
    expect(lastQuery().playedFrom).toBe(start);
    expect(chipLabels()).toEqual([`Played date: ${shown}`]);

    // Back on the heatmap the day is still the one marked.
    fireEvent.click(screen.getByRole("button", { name: "Contribution graph" }));
    await waitFor(() =>
      expect(cell(yesterday).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("has no folder form: the stored option waits for the list views", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "true");
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(cell(yesterday).dataset.level).toBe("4"));

    const toggle = screen.getByRole("button", { name: "Show by folder" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("title")).toBe(
      "Folder view is not available in the contribution graph",
    );
    expect(lastQuery().folder).toBeUndefined();
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("true");
  });
});
