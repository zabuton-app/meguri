// The way into the playlist from a file's detail view: `/play?start=<ws>:<id>`
// plays the list the user is browsing from that very file, carrying on with
// its playback rather than starting it over — the mirror of the player's own
// detail button (see PlayerDetailLink.test.tsx for the trip the other way).
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import Player from "@/routes/Player";
import { useAudioPlayer } from "@/audio/useAudioPlayer";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { announceVideoHandOff, resetVideoHandOff } from "@/video/videoHandOff";

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

function row(id: number, kind: "video" | "image" | "audio"): FileRow {
  if (kind === "audio")
    return { ...sampleAudioRow, id, relPath: `music/track-${id}.mp3` };
  return {
    ...sampleFileRow,
    id,
    kind,
    relPath:
      kind === "image" ? `photos/pic-${id}.jpg` : `videos/clip-${id}.mp4`,
  };
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

function renderPlayer(items: FileRow[], route: string, strict = false) {
  mocks.fileGet.mockImplementation((id: number) => {
    const found = items.find((r) => r.id === id) ?? items[0];
    const detail: FileDetail = { ...sampleFileDetail, ...found };
    return Promise.resolve(detail);
  });
  const tree = (
    <MediaNavProvider value={nav(items)}>
      <Player />
    </MediaNavProvider>
  );
  return renderWithProviders(strict ? <StrictMode>{tree}</StrictMode> : tree, {
    route,
  });
}

/** The <video> serving the given file, once the media URL has been resolved. */
async function videoFor(fileId: number): Promise<HTMLVideoElement> {
  let video: HTMLVideoElement | null = null;
  await waitFor(() => {
    video = document.querySelector("video");
    expect(video?.getAttribute("src")).toContain(`/media/${fileId}`);
  });
  return video!;
}

/** What the detail view does before handing over: the track is in the bar,
 *  in whatever state the user left it — and only then does the player mount,
 *  the way the route switch brings it in after the detail view is gone. */
function DetailThenPlayer({
  track,
  items,
}: {
  track: FileRow;
  items: FileRow[];
}) {
  const { play } = useAudioPlayer();
  const [playerOpen, setPlayerOpen] = useState(false);
  return (
    <>
      <button onClick={() => play(track, WS_ID)}>bar-play</button>
      <button onClick={() => setPlayerOpen(true)}>open-player</button>
      {playerOpen && (
        <MediaNavProvider value={nav(items)}>
          <Player />
        </MediaNavProvider>
      )}
    </>
  );
}

let el: HTMLAudioElement | undefined;
function capture(instance: HTMLAudioElement): void {
  el = instance;
}
let playSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetVideoHandOff();
  localStorage.clear();
  el = undefined;
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockResolvedValue(undefined);
  playSpy = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    playSpy as unknown as HTMLMediaElement["play"],
  );
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

describe("Player started from a file", () => {
  it("opens the pass on the named file, with the rest of the list to follow", async () => {
    const items = [row(1, "video"), row(3, "video"), row(5, "video")];
    renderPlayer(items, `/play?start=${WS_ID}:3`);
    await videoFor(3);
    // A fresh pass, not a resumed one: nothing has played before this file.
    expect(await screen.findByText("1 / 3")).toBeTruthy();
    expect(screen.getByLabelText("Previous (P)")).toHaveProperty(
      "disabled",
      true,
    );
    act(() => {
      fireEvent.click(screen.getByLabelText("Next (N)"));
    });
    // The list order carries on from the file, not from its head.
    await videoFor(5);
    expect(await screen.findByText("2 / 3")).toBeTruthy();
  });

  it("carries the video on from the second the detail view got to", async () => {
    renderPlayer([row(1, "video")], `/play?start=${WS_ID}:1&t=90`);
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    // Nothing is seekable in jsdom, so the player re-serves the stream from the
    // second it wants — where the detail view was.
    await waitFor(() => expect(video.getAttribute("src")).toContain("t=90"));
  });

  it("drops the handed-over second once the pass moves on", async () => {
    const items = [row(1, "video"), row(3, "video")];
    renderPlayer(items, `/play?start=${WS_ID}:1&t=90`);
    await screen.findByText("1 / 2");
    act(() => {
      fireEvent.click(screen.getByLabelText("Next (N)"));
    });
    await screen.findByText("2 / 2");
    fireEvent.click(screen.getByLabelText("Previous (P)"));
    await screen.findByText("1 / 2");
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    // Back on the same file by ordinary paging: it starts where any other item
    // would, not at the second the detail view once handed over.
    expect(video.getAttribute("src")).not.toContain("t=");
  });

  it("falls back to the head of the list for a file the list does not hold", async () => {
    const items = [row(1, "video"), row(3, "video")];
    renderPlayer(items, `/play?start=${WS_ID}:99&t=90`);
    await videoFor(1);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    // The second was for the missing file, not for whatever plays instead.
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);
    expect(video.getAttribute("src")).not.toContain("t=");
  });

  it("ignores a start token that does not name a file", async () => {
    renderPlayer([row(1, "video"), row(3, "video")], "/play?start=garbage");
    await videoFor(1);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("survives StrictMode's double-invoked mount effects", async () => {
    const items = [row(1, "video"), row(3, "video")];
    renderPlayer(items, `/play?start=${WS_ID}:3`, true);
    await videoFor(3);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("falls back to the start file when the resumed pass is gone", async () => {
    // What the detail view hands back names both: a pass that was already
    // spent (the history walked back to the detail URL) must not land on the
    // head of the list when the file to start on is right there.
    const items = [row(1, "video"), row(3, "video")];
    renderPlayer(items, `/play?resume=${WS_ID}:3&start=${WS_ID}:3`);
    await videoFor(3);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("adopts the <video> the detail view handed over rather than reloading it", async () => {
    // Stand in for the detail view: a host playing the file that announces
    // the hand-off and unmounts (see videoHandOff.ts).
    const items = [row(1, "video")];
    const host = renderPlayer(items, "/play");
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 90.4,
    });
    announceVideoHandOff(`${defaultAppStatus.mediaBase}/ws/${WS_ID}/media/1`);
    host.unmount();
    expect(document.contains(video)).toBe(true);

    renderPlayer(items, `/play?start=${WS_ID}:1&t=90`);
    await screen.findByLabelText("Pause (Space)");
    // Same element, same source (no `?t=` re-serve), position untouched.
    expect(document.querySelector("video")).toBe(video);
    expect(video.getAttribute("src")).not.toContain("t=");
    expect(video.currentTime).toBe(90.4);
  });

  describe("with the file's track in the bar", () => {
    const items = [row(2, "audio"), row(4, "audio")];

    /** The track is loaded in the bar; `events` puts it in the state the user
     *  left it in. Then the player opens on that file. */
    async function startFromBar(fileId: number, events: string[]) {
      mocks.fileGet.mockImplementation((id: number) => {
        const detail: FileDetail = {
          ...sampleFileDetail,
          ...(items.find((r) => r.id === id) ?? items[0]),
        };
        return Promise.resolve(detail);
      });
      renderWithProviders(<DetailThenPlayer track={items[0]} items={items} />, {
        route: `/play?start=${WS_ID}:${fileId}`,
      });
      fireEvent.click(screen.getByText("bar-play"));
      await waitFor(() => expect(el?.src ?? "").toContain("/media/2"));
      act(() => {
        for (const type of events) el!.dispatchEvent(new Event(type));
      });
      fireEvent.click(screen.getByText("open-player"));
      // Let the player's audio effect run its course before looking at the bar.
      expect(await screen.findByText("1 / 2")).toBeTruthy();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it("leaves a playing track alone rather than starting it over", async () => {
      await startFromBar(2, ["play"]);
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(el!.getAttribute("src")).toContain("/media/2");
      expect(document.querySelector("video")).toBeNull();
    });

    it("picks a track paused in the detail view back up", async () => {
      // Unlike coming back from a detour, this pass was asked to play: a
      // track the user had paused there would otherwise sit silent for good.
      await startFromBar(2, ["play", "pause"]);
      // Resumed through the bar's element — not reloaded from the top.
      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(el!.getAttribute("src")).toContain("/media/2");
    });

    it("replays a track that ran out in the detail view instead of skipping it", async () => {
      await startFromBar(2, ["play", "ended"]);
      // Still on the file the user asked for, and playing it again.
      expect(screen.getByText("1 / 2")).toBeTruthy();
      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(el!.getAttribute("src")).toContain("/media/2");
    });
  });
});
