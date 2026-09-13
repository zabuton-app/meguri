// Audio items in the playlist play through the bottom bar's element, not a
// <video> of the player's own, so stepping out to the detail view never
// interrupts them. This covers that wiring: start, advance on end, and what
// the detail link asks for.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import Player from "@/routes/Player";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleFileDetail,
  sampleFileRow,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

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

function audioRow(id: number): FileRow {
  return { ...sampleAudioRow, id, relPath: `music/track-${id}.mp3` };
}
function videoRow(id: number): FileRow {
  return { ...sampleFileRow, id, relPath: `videos/clip-${id}.mp4` };
}
function detailFor(row: FileRow): FileDetail {
  return { ...sampleFileDetail, ...row };
}

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

function renderPlayer(items: FileRow[]) {
  mocks.fileGet.mockImplementation((id: number) =>
    Promise.resolve(detailFor(items.find((r) => r.id === id) ?? items[0])),
  );
  return renderWithProviders(
    <MediaNavProvider value={nav(items)}>
      <Player />
    </MediaNavProvider>,
    { route: "/play" },
  );
}

let el: HTMLAudioElement | undefined;
function capture(instance: HTMLAudioElement): void {
  el = instance;
}
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  el = undefined;
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockResolvedValue(undefined);
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

const at = () => window.location.hash.slice(1);

describe("Player audio items", () => {
  it("plays an audio item through the bar's element, with no <video> of its own", async () => {
    renderPlayer([audioRow(2), audioRow(4)]);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("video")).toBeNull();
    // The bar is under the player, not on top of it.
    expect(screen.queryByRole("region", { name: /audio player/i })).toBeNull();
  });

  it("advances to the next item when the track ends", async () => {
    renderPlayer([audioRow(2), audioRow(4)]);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    act(() => {
      el!.dispatchEvent(new Event("ended"));
    });
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    await waitFor(() => expect(el?.src ?? "").toContain("/media/4"));
  });

  it("opens the detail view without touching playback", async () => {
    renderPlayer([audioRow(2)]);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    act(() => {
      el!.dispatchEvent(new Event("play"));
    });
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(at()).toContain("/file/2"));
    // The bar keeps playing across the trip, so the detail view is asked not
    // to start (or resume) anything, and there is no position to carry.
    expect(at()).toContain("autoplay=0");
    expect(at()).toContain("from=player");
    expect(at()).not.toContain("t=");
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("a video item that follows takes the sound over", async () => {
    renderPlayer([audioRow(2), videoRow(3)]);
    await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
    act(() => {
      el!.dispatchEvent(new Event("play"));
    });
    fireEvent.keyDown(window, { code: "KeyN" });
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    // The bar's track is paused (not closed) for the video.
    await waitFor(() => expect(pauseSpy).toHaveBeenCalled());
    expect(el!.getAttribute("src")).toContain("/media/2");
  });
});
