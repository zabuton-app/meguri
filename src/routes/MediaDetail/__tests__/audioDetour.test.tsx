// The playlist player stepping out to an audio track's detail view and back.
// Both play audio through the bottom bar's element, which lives outside the
// router, so the trip is not a hand-over at all: the detail view leaves the
// track exactly as it found it, and closing gives the playlist its pass back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import type { FileDetail } from "@/ipc/types";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleAudioRow,
  sampleFileDetail,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useAudioPlayer } from "@/audio/useAudioPlayer";

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
    fileDeleteFromIndex: vi.fn().mockResolvedValue({ id: 2 }),
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

/** The provider's single element, captured so the test can read and set its position. */
let el: HTMLAudioElement;
function capture(instance: HTMLAudioElement): void {
  el = instance;
}
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  mocks.fileGet.mockResolvedValue(audioDetail);
  mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
  playSpy = vi.fn().mockResolvedValue(undefined);
  pauseSpy = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    playSpy as unknown as HTMLMediaElement["play"],
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    pauseSpy as unknown as HTMLMediaElement["pause"],
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const OriginalAudio = window.Audio;
  vi.stubGlobal(
    "Audio",
    class extends OriginalAudio {
      constructor() {
        super();
        capture(this);
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function DetailRoute() {
  return (
    <Routes>
      <Route path="file/:id" element={<MediaDetail />} />
    </Routes>
  );
}

/** What the playlist does before stepping out: the track is in the bar. */
function BarDriver() {
  const { play } = useAudioPlayer();
  return <button onClick={() => play(sampleAudioRow, WS_ID)}>bar-play</button>;
}

async function openDetail(route: string) {
  renderWithProviders(
    <>
      <BarDriver />
      <DetailRoute />
    </>,
    { route },
  );
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
  });
}

const at = () => window.location.hash.slice(1);
const query = () => new URLSearchParams(at().split("?")[1] ?? "");

describe("audio detour from the playlist", () => {
  it("leaves the track playing in the bar, untouched, and hands the pass back on close", async () => {
    await openDetail(`/file/2?ws=${WS_ID}&from=player&autoplay=0`);
    // The playlist had the track going in the bar (it navigates with
    // autoplay=0 for exactly this reason).
    fireEvent.click(screen.getByText("bar-play"));
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    const playsBefore = playSpy.mock.calls.length;
    act(() => {
      el.currentTime = 95.25;
    });

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("resume")).toBe(`${WS_ID}:2`);
    // Nothing to hand back: the sound never left the bar.
    expect(query().has("t")).toBe(false);
    // Not restarted, not paused, not closed.
    expect(playSpy.mock.calls.length).toBe(playsBefore);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(el.getAttribute("src")).toContain("/media/2");
    expect(el.currentTime).toBe(95.25);
  });
});

describe("spectrum pattern key in the detail view", () => {
  const pattern = () =>
    screen.getByTestId("audio-spectrum").getAttribute("data-pattern");

  it("V steps forward and Shift+V back, wrapping, and turns the display on", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ audioSpectrum: false, audioSpectrumPattern: "bars" }),
    );
    await openDetail(`/file/2?ws=${WS_ID}&autoplay=0`);
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
    fireEvent.keyDown(window, { code: "KeyV" });
    expect(pattern()).toBe("ring");
    fireEvent.keyDown(window, { code: "KeyV", shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyV", shiftKey: true });
    expect(pattern()).toBe("barcode");
  });

  it("leaves V alone while typing, and with other modifiers", async () => {
    await openDetail(`/file/2?ws=${WS_ID}&autoplay=0`);
    expect(pattern()).toBe("bars");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { code: "KeyV" });
    expect(pattern()).toBe("bars");
    input.blur();
    fireEvent.keyDown(window, { code: "KeyV", ctrlKey: true });
    fireEvent.keyDown(window, { code: "KeyV", altKey: true });
    expect(pattern()).toBe("bars");
    input.remove();
  });
});
