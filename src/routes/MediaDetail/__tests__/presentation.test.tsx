// How the detail view is presented: a modal over the window, or a side peek
// docked to the list area. The choice and the modal size are remembered
// separately, so the view reopens the way it was left and going back from the
// peek lands on the modal size last chosen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import { MediaNavProvider } from "@/components/MediaNavContext";
import { useBarSuppressed } from "@/audio/barVisibility";
import type { FileDetail } from "@/ipc/types";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleAudioRow,
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
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
    workspacesList: (): Promise<unknown> =>
      mocks.workspacesList() as Promise<unknown>,
    fileGet: (id: number, ws: string): Promise<unknown> =>
      mocks.fileGet(id, ws) as Promise<unknown>,
    filesSearch: (query: unknown): Promise<unknown> =>
      mocks.filesSearch(query) as Promise<unknown>,
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

const audioDetail: FileDetail = {
  ...sampleFileDetail,
  ...sampleAudioRow,
  absPath: "/media/music/track.mp3",
  codec: "mp3",
  fps: null,
};

/** Reports whether the bottom bar is told to step aside, as the bar would. */
function BarProbe() {
  const suppressed = useBarSuppressed();
  return <output data-testid="bar-suppressed">{String(suppressed)}</output>;
}

function DetailRoute() {
  return (
    <MediaNavProvider
      value={{
        items: [sampleFileRow, sampleAudioRow],
        listOffset: 0,
        fetchNextPage: () => {},
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchPreviousPage: () => {},
        hasPreviousPage: false,
        isFetchingPreviousPage: false,
      }}
    >
      <BarProbe />
      <Routes>
        <Route path="file/:id" element={<MediaDetail />} />
      </Routes>
    </MediaNavProvider>
  );
}

async function openDetail(route: string, heading = "sample.mp4") {
  renderWithProviders(<DetailRoute />, { route });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
  });
}

const dialog = () => screen.getByRole("dialog");
const barSuppressed = () =>
  screen.getByTestId("bar-suppressed").textContent === "true";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  mocks.fileGet.mockResolvedValue(sampleFileDetail);
  mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaDetail presentation", () => {
  it("opens as a modal by default and hides the bar", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(barSuppressed()).toBe(true);
  });

  it("switches to the side peek from the header, keeping the bar, and remembers it", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Open as side peek" }));
    // A sheet beside the list rather than a modal over it: no backdrop, and
    // the bar below the list area stays put.
    expect(dialog().getAttribute("aria-modal")).toBeNull();
    expect(dialog().dataset.presentation).toBe("peek");
    expect(barSuppressed()).toBe(false);
    expect(localStorage.getItem("meguri.media.presentation")).toBe("peek");
    // The file is still on screen, just re-framed.
    expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
  });

  it("re-frames without remounting the player when switching either way", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open as side peek" }));
    // The same element: a playing video keeps its position across the switch.
    expect(document.querySelector("video")).toBe(video);
    fireEvent.click(screen.getByRole("button", { name: "Open as modal" }));
    expect(document.querySelector("video")).toBe(video);
  });

  it("reopens as the peek and returns to the modal at its remembered size", async () => {
    localStorage.setItem("meguri.media.presentation", "peek");
    localStorage.setItem("meguri.media.modalSize", "small");
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(dialog().dataset.presentation).toBe("peek");
    // The peek offers no size toggle of its own — only the way back.
    expect(screen.queryByRole("button", { name: "Enlarge modal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open as modal" }));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(barSuppressed()).toBe(true);
    expect(localStorage.getItem("meguri.media.presentation")).toBe("modal");
    // Small, as it was last left — not reset to large by the round trip.
    const toggle = screen.getByRole("button", { name: "Enlarge modal" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the peek with Esc like the modal", async () => {
    localStorage.setItem("meguri.media.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(window.location.hash.slice(1)).toBe("/"));
  });

  it("shows an audio track as a tile without its own transport in the peek", async () => {
    localStorage.setItem("meguri.media.presentation", "peek");
    mocks.fileGet.mockResolvedValue(audioDetail);
    await openDetail(`/file/2?ws=${WS_ID}&autoplay=0`, "track.mp3");
    // The bar is the transport here, so the stage's transport region is gone…
    expect(screen.queryByRole("region", { name: "Audio player" })).toBeNull();
    expect(barSuppressed()).toBe(false);
    // …but the tile still offers click-to-play.
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
