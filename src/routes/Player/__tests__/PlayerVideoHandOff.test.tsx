// Stepping out of the playlist to a video's detail view and back hands the
// playing <video> across rather than reloading it (see video/videoHandOff.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import Player from "@/routes/Player";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/renderWithProviders";
import { announceVideoHandOff, resetVideoHandOff } from "@/video/videoHandOff";
import type { QueryClient } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  fileGet: vi.fn(),
  fileRecordPlay: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
    fileGet: (id: number, ws: string): Promise<unknown> =>
      mocks.fileGet(id, ws) as Promise<unknown>,
    fileRecordPlay: (...args: unknown[]): Promise<void> =>
      mocks.fileRecordPlay(...args) as Promise<void>,
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  events: {},
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

const clip: FileRow = { ...sampleFileRow, id: 1, relPath: "videos/clip-1.mp4" };
const detail: FileDetail = { ...sampleFileDetail, ...clip };

function nav(items: FileRow[]): MediaNav {
  return {
    items,
    listOffset: 0,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchPreviousPage: vi.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
  };
}

// One cache across the two mounts, as in the app: the media origin is known
// when the player comes back, so its video has its source from the first render.
let queryClient: QueryClient;

function renderPlayer(route = "/play") {
  return renderWithProviders(
    <MediaNavProvider value={nav([clip])}>
      <Player />
    </MediaNavProvider>,
    { route, queryClient },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.fileGet.mockResolvedValue(detail);
  mocks.fileRecordPlay.mockResolvedValue(undefined);
  queryClient = createTestQueryClient();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  resetVideoHandOff();
  vi.restoreAllMocks();
});

async function videoFor(fileId: number): Promise<HTMLVideoElement> {
  let video: HTMLVideoElement | null = null;
  await waitFor(() => {
    video = document.querySelector("video");
    expect(video?.getAttribute("src")).toContain(`/media/${fileId}`);
  });
  return video!;
}

/** What a playing element looks like by the time the next host mounts. Also
 *  puts a pause spy on this element alone — the prototype is shared with the
 *  audio bar's element, which the player pauses on purpose. */
function markPlaying(video: HTMLVideoElement, at: number) {
  const pauseSpy = vi.fn();
  Object.defineProperty(video, "pause", {
    configurable: true,
    value: pauseSpy,
  });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    writable: true,
    value: at,
  });
  fireEvent.timeUpdate(video);
  return pauseSpy;
}

describe("Player video hand-off", () => {
  it("leaves the playing element in place for the detail view when stepping out", async () => {
    const first = renderPlayer();
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    const pauseSpy = markPlaying(video, 42.6);

    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(window.location.hash).toContain("/file/1"));
    // The route switch unmounts the player.
    first.unmount();

    // Parked for the detail view: still in the document, never paused.
    expect(document.contains(video)).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(video.getAttribute("src")).not.toContain("t=");
  });

  it("takes the element back from the detail view without reloading or seeking", async () => {
    const first = renderPlayer();
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    const pauseSpy = markPlaying(video, 42.6);
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(window.location.hash).toContain("/file/1"));
    first.unmount();

    // The detail view watched on to 90 s, announced the hand-off on close
    // (the way MediaDetail.onClose does) and handed back a whole second.
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 90.4,
    });
    announceVideoHandOff(`${defaultAppStatus.mediaBase}/ws/${WS_ID}/media/1`);
    renderPlayer(`/play?resume=${WS_ID}:1&t=90`);
    await screen.findByLabelText("Pause (Space)");
    // Same element, same source (no `?t=` re-serve), position untouched.
    expect(document.querySelector("video")).toBe(video);
    expect(video.getAttribute("src")).not.toContain("t=");
    expect(video.currentTime).toBe(90.4);
    expect(pauseSpy).not.toHaveBeenCalled();
  });
});
