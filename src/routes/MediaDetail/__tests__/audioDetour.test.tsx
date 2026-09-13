// The playlist player stepping out to an audio track's detail view and back.
// The playlist plays audio through its own <video>; the detail view plays it
// through the bottom bar. So the hop is a hand-over in both directions: the
// bar picks the track up where the playlist was, and closing gives the
// playlist the bar's position back and lets go of the track.
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  mocks.fileGet.mockResolvedValue(audioDetail);
  mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
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

async function openDetail(route: string) {
  renderWithProviders(<DetailRoute />, { route });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
  });
}

const at = () => window.location.hash.slice(1);
const query = () => new URLSearchParams(at().split("?")[1] ?? "");

describe("audio detour from the playlist", () => {
  it("picks the track up in the bar where the playlist left it", async () => {
    await openDetail(`/file/2?ws=${WS_ID}&from=player&t=83.5`);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    // Not from the top: the playlist was 83.5 s in when it stepped out.
    expect(el.currentTime).toBe(83.5);
  });

  it("hands the bar's position back and lets go of the track on close", async () => {
    await openDetail(`/file/2?ws=${WS_ID}&from=player&t=83.5`);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    // Listened on for a while here.
    act(() => {
      el.currentTime = 95.25;
    });
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(at()).toContain("/play?"));
    expect(query().get("resume")).toBe(`${WS_ID}:2`);
    // Exact, not floored: a second of rewind is audible across the hop.
    expect(query().get("t")).toBe("95.25");
    // The playlist plays it through its own element from here, so the bar
    // is closed rather than left paused underneath the player.
    expect(el.hasAttribute("src")).toBe(false);
  });
});
