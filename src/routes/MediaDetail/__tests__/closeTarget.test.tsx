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
import { sampleAudioRow } from "@/test/fixtures";

const handOff = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/video/videoHandOff", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/video/videoHandOff")>();
  return {
    ...mod,
    announceVideoHandOff: (src: string) => handOff.announce(src),
  };
});

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

/** The query the router ended up with. */
const query = () => new URLSearchParams(at().split("?")[1] ?? "");

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
    expect(query().get("resume")).toBe(`${WS_ID}:1`);
    // Nothing has played here, so there is no position worth handing back.
    expect(query().has("t")).toBe(false);
  });

  it("hands the playing video over to the player on close", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    close();
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(handOff.announce).toHaveBeenCalledWith(
      `${defaultAppStatus.mediaBase}/ws/${WS_ID}/media/1`,
    );
  });

  it("announces no hand-off for a file without a video player", async () => {
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      ...sampleAudioRow,
      id: 1,
      absPath: "/media/music/track.mp3",
      codec: "mp3",
      fps: null,
    });
    renderWithProviders(<DetailRoute />, {
      route: `/file/1?ws=${WS_ID}&from=player`,
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
    });
    close();
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(handOff.announce).not.toHaveBeenCalled();
  });

  it("keeps the detour's position when closed before anything has played", async () => {
    // This player reports 0 until its metadata loads, so closing straight away
    // must not hand back a zero that rewinds the playlist to the top of the
    // file the user was already partway through.
    await openDetail(`/file/1?ws=${WS_ID}&from=player&t=90`);
    close();
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("t")).toBe("90");
  });

  it("hands playback back from the close button too, not just Esc", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    fireEvent.click(screen.getByTitle("Close (Esc)"));
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("resume")).toBe(`${WS_ID}:1`);
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

// The trip the other way: the detail view's own button into the playlist
// player, which plays the list from the file on screen and carries its
// playback across — by name, so the player opens on this file and not the
// head of the list.
describe("MediaDetail playlist button", () => {
  const button = () =>
    screen.getByRole("button", { name: "Play as playlist from here" });

  it("plays the list from this file, handing the video over", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("start")).toBe(`${WS_ID}:1`);
    expect(query().has("resume")).toBe(false);
    expect(handOff.announce).toHaveBeenCalledWith(
      `${defaultAppStatus.mediaBase}/ws/${WS_ID}/media/1`,
    );
    // Nothing has played here, so there is no position worth handing over.
    expect(query().has("t")).toBe(false);
  });

  it("carries the second it arrived at when nothing has played yet", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&t=90`);
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("t")).toBe("90");
  });

  it("hands over where the video really is, even wound back to the start", async () => {
    // Arrived at 90 s, then seeked back to the top: the fallback second is
    // the arrival one only while the player has no position of its own yet.
    await openDetail(`/file/1?ws=${WS_ID}&t=90`);
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);
    // Home winds the player back to the start.
    fireEvent.keyDown(window, { code: "Home" });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 0,
    });
    fireEvent.timeUpdate(video);
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().has("t")).toBe(false);
  });

  it("neither hands over nor seeks a video that ran to its end", async () => {
    // The player would adopt the ended element and move straight on, past the
    // file the user asked to start on; instead it loads the file afresh.
    await openDetail(`/file/1?ws=${WS_ID}&t=90`);
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);
    Object.defineProperty(video, "ended", { configurable: true, value: true });
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("start")).toBe(`${WS_ID}:1`);
    expect(query().has("t")).toBe(false);
    expect(handOff.announce).not.toHaveBeenCalled();
  });

  it("still hands an ended video back to the pass it came from", async () => {
    // A detour that ran the file out is the player's cue to move on, which it
    // reads off the adopted element.
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);
    Object.defineProperty(video, "ended", { configurable: true, value: true });
    close();
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(handOff.announce).toHaveBeenCalled();
  });

  it("hands the parked pass back instead when it came from the player", async () => {
    await openDetail(`/file/1?ws=${WS_ID}&from=player`);
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("resume")).toBe(`${WS_ID}:1`);
    // Named as the fallback too: a pass that is gone (the history walked
    // back here) then starts afresh on this file rather than at the head.
    expect(query().get("start")).toBe(`${WS_ID}:1`);
  });

  it("announces no hand-off for a file without a video player", async () => {
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      ...sampleAudioRow,
      id: 1,
      absPath: "/media/music/track.mp3",
      codec: "mp3",
      fps: null,
    });
    renderWithProviders(<DetailRoute />, { route: `/file/1?ws=${WS_ID}` });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
    });
    fireEvent.click(button());
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("start")).toBe(`${WS_ID}:1`);
    expect(query().has("t")).toBe(false);
    expect(handOff.announce).not.toHaveBeenCalled();
  });

  it("is disabled for a file the list does not hold", async () => {
    // The queue is built from the list, so a file outside it (opened from the
    // bottom bar after the list moved on) has no playlist to start.
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, id: 99 });
    renderWithProviders(<DetailRoute />, { route: `/file/99?ws=${WS_ID}` });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(button()).toHaveProperty("disabled", true);
  });

  it("is disabled for a file the list dropped, even on a detour from the player", async () => {
    // The parked pass may be gone by now (the history walked back to this
    // URL), and then the player would fall back to the list's head.
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, id: 99 });
    renderWithProviders(<DetailRoute />, {
      route: `/file/99?ws=${WS_ID}&from=player`,
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(button()).toHaveProperty("disabled", true);
  });

  it("is absent without a list to play", async () => {
    renderWithProviders(
      <Routes>
        <Route path="file/:id" element={<MediaDetail />} />
      </Routes>,
      { route: `/file/1?ws=${WS_ID}` },
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: "Play as playlist from here" }),
    ).toBeNull();
  });
});
