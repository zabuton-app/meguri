// Where closing the detail view lands. The modal is opened from three places
// that each expect to get the user back: the list, Discovery, and the playlist
// player — the last of which has a pass parked and needs to be asked for it by
// name, so that a queue can never be resumed under an unrelated later playback.
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function DetailRoute() {
  return (
    <MediaNavProvider
      value={{
        items: [sampleFileRow, second],
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

/** Open the detail view at `route` and wait for the file to be on screen. */
async function openDetail(route: string) {
  renderWithProviders(<DetailRoute />, { route });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
  });
}

/** Where the router ended up, without the leading "#". */
const at = () => window.location.hash.slice(1);

function close() {
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  mocks.fileGet.mockResolvedValue(sampleFileDetail);
  mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
});

describe("MediaDetail close target", () => {
  it("returns to the list by default", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    close();
    await waitFor(() => expect(at()).toBe("/"));
  });

  it("returns to Discovery when it came from there", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=discover&filter=video`);
    close();
    await waitFor(() => expect(at()).toBe("/discover?filter=video"));
  });

  it("hands playback back when it came from the player", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    close();
    // Names the file the pass was parked on — the player restores only when
    // that matches what it put aside — and where this view got to, so watching
    // on here and then closing does not rewind to the second of the detour.
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(at()).toContain(`resume=${encodeURIComponent(`${WS_ID}:1`)}`);
    expect(at()).toContain("t=0");
  });

  it("hands playback back from the close button too, not just Esc", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    fireEvent.click(screen.getByTitle("Close (Esc)"));
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(at()).toContain(`resume=${encodeURIComponent(`${WS_ID}:1`)}`);
  });

  it("stops being a detour once the user pages to another file", async () => {
    // The player's pass is parked on the file we arrived with; walking off it
    // and then handing playback back would resume somewhere the user is not.
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    fireEvent.click(screen.getByRole("button", { name: "Next file" }));
    await waitFor(() => expect(at()).toContain("/file/2"));
    expect(at()).not.toContain("from=player");
  });

  it("keeps carrying the Discovery origin across paging", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=discover`);
    fireEvent.click(screen.getByRole("button", { name: "Next file" }));
    await waitFor(() => expect(at()).toContain("/file/2"));
    expect(at()).toContain("from=discover");
  });
});
