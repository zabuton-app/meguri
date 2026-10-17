import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n/I18nProvider";
import { NAV_BINDINGS } from "@/settings/keybindings";
import {
  VideoPlayer,
  type PlayerHandle,
} from "@/routes/MediaDetail/VideoPlayer";
import { announceVideoHandOff, resetVideoHandOff } from "@/video/videoHandOff";

const fileRecordPlay = vi.fn().mockResolvedValue(undefined);
const fileSavePosition = vi
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({
  api: {
    fileRecordPlay: (...args: unknown[]) => fileRecordPlay(...args),
    fileSavePosition: (...args: unknown[]) => fileSavePosition(...args),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

/** The player reports positions into the query cache, so it needs a client. */
function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}

function renderPlayer(
  overrides: Partial<Parameters<typeof VideoPlayer>[0]> = {},
) {
  const onAddBookmark = vi.fn();
  const onRemoveBookmark = vi.fn();
  const onExportFrame = vi.fn();
  const onNativeDuration = vi.fn();
  const onPlayed = vi.fn();
  const onOpenExternal = vi.fn();
  const t = (key: string) => key;

  const props = {
    id: 1,
    src: "http://127.0.0.1:17345/ws/ws1/media/1",
    duration: 120,
    width: 1920,
    height: 1080,
    mediaBase: "http://127.0.0.1:17345",
    wsId: "ws1",
    startAt: 0,
    navKeys: NAV_BINDINGS.normal,
    bookmarks: [],
    bookmarkPending: false,
    onAddBookmark,
    onRemoveBookmark,
    exportPending: false,
    onExportFrame,
    onNativeDuration,
    onPlayed,
    onOpenExternal,
    t,
    ...overrides,
  };

  const ref = createRef<PlayerHandle>();
  const view = render(
    <Providers>
      <VideoPlayer ref={ref} {...props} />
    </Providers>,
  );

  const video = document.querySelector("video") as HTMLVideoElement;
  return {
    video,
    ref,
    view,
    onAddBookmark,
    onRemoveBookmark,
    onExportFrame,
    onPlayed,
  };
}

function loadVideo(video: HTMLVideoElement) {
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(video, "seekable", {
    configurable: true,
    value: {
      length: 1,
      start: () => 0,
      end: () => 120,
    },
  });
  fireEvent.loadedMetadata(video);
}

function fireVideoError(video: HTMLVideoElement, code: number) {
  Object.defineProperty(video, "error", {
    configurable: true,
    value: { code },
  });
  fireEvent.error(video);
}

describe("VideoPlayer", () => {
  beforeEach(() => {
    fileRecordPlay.mockClear();
  });
  afterEach(() => {
    resetVideoHandOff();
  });

  describe("adopting a handed-over element", () => {
    /** What a playing element looks like by the time the next host mounts. */
    function markPlaying(video: HTMLVideoElement, at: number) {
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
        value: at,
      });
    }

    it("continues where the element is instead of loading and seeking to startAt", () => {
      const first = renderPlayer();
      loadVideo(first.video);
      markPlaying(first.video, 42.6);
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      // The next host's route replaces this one.
      cleanup();

      const onNativeDuration = vi.fn();
      // The other route reports whole seconds, so `startAt` lags the element;
      // applying it would be the very jump the hand-off exists to avoid.
      const second = renderPlayer({ startAt: 42, onNativeDuration });
      expect(second.video).toBe(first.video);
      expect(second.video.getAttribute("src")).not.toContain("t=");
      expect(second.video.currentTime).toBe(42.6);
      // Picked up as loaded and playing: the duration is reported, the centre
      // play button (paused state) is not shown, and the handle knows where it is.
      expect(onNativeDuration).toHaveBeenCalledWith(120);
      expect(screen.queryByTitle("player.play")).toBeNull();
      expect(second.ref.current?.currentTime()).toBe(42.6);
      // This host's callers still get the start (the play that began it went
      // to the previous host); the play itself is not recorded twice.
      expect(second.onPlayed).toHaveBeenCalledTimes(1);
      expect(fileRecordPlay).not.toHaveBeenCalled();
    });

    it("advances on an element that ended while nobody was listening", () => {
      const first = renderPlayer();
      loadVideo(first.video);
      markPlaying(first.video, 120);
      Object.defineProperty(first.video, "paused", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(first.video, "ended", {
        configurable: true,
        value: true,
      });
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      cleanup();
      const onEnded = vi.fn();
      renderPlayer({ onEnded });
      // The `ended` event went to nobody; the state says it happened.
      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it("surfaces a failure that happened while the element was parked, even with no metadata", () => {
      const first = renderPlayer();
      loadVideo(first.video);
      markPlaying(first.video, 10);
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      cleanup();
      // Failed during the hand-off: no metadata left, no event coming. The
      // park check saw it healthy; the arriving host must not adopt it.
      Object.defineProperty(first.video, "readyState", {
        configurable: true,
        value: 0,
      });
      Object.defineProperty(first.video, "error", {
        configurable: true,
        value: { code: 3 },
      });
      const { video } = renderPlayer();
      // A fresh element and a fresh load — a real retry, whose outcome will
      // arrive as an event — rather than a dead element with nothing to wait for.
      expect(video).not.toBe(first.video);
      expect(video.getAttribute("src")).toBe(
        "http://127.0.0.1:17345/ws/ws1/media/1",
      );
      expect(screen.queryByText("player.playFailed")).toBeNull();
    });

    it("reports an ended element's end once under StrictMode", () => {
      const first = renderPlayer();
      loadVideo(first.video);
      markPlaying(first.video, 120);
      Object.defineProperty(first.video, "paused", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(first.video, "ended", {
        configurable: true,
        value: true,
      });
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      cleanup();
      const onEnded = vi.fn();
      render(
        <StrictMode>
          <Providers>
            <VideoPlayer
              id={1}
              src="http://127.0.0.1:17345/ws/ws1/media/1"
              duration={120}
              width={1920}
              height={1080}
              mediaBase="http://127.0.0.1:17345"
              wsId="ws1"
              startAt={0}
              navKeys={NAV_BINDINGS.normal}
              onNativeDuration={() => undefined}
              onPlayed={() => undefined}
              onEnded={onEnded}
              t={(key: string) => key}
            />
          </Providers>
        </StrictMode>,
      );
      // The effect ran twice; the playlist must move on one item, not two.
      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it("still applies startAt to a fresh element that loaded before the effect ran", () => {
      // Not adopted, merely quick: metadata can be in before the host's effect
      // runs, and that must not be mistaken for a hand-off.
      const { video } = renderPlayer({ startAt: 30 });
      Object.defineProperty(video, "readyState", {
        configurable: true,
        value: 1,
      });
      Object.defineProperty(video, "duration", {
        configurable: true,
        value: 120,
      });
      fireEvent.loadedMetadata(video);
      // Nothing is seekable in jsdom, so the seek re-serves the stream.
      expect(video.getAttribute("src")).toContain("t=30");
    });

    it("keeps a paused element paused", () => {
      const first = renderPlayer();
      loadVideo(first.video);
      markPlaying(first.video, 10);
      Object.defineProperty(first.video, "paused", {
        configurable: true,
        value: true,
      });
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      cleanup();
      const play = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(first.video, "play", {
        configurable: true,
        value: play,
      });
      const second = renderPlayer({ startAt: 10 });
      expect(second.video).toBe(first.video);
      expect(play).not.toHaveBeenCalled();
      expect(screen.queryByTitle("player.play")).not.toBeNull();
    });
  });

  describe("box shape", () => {
    const boxOf = (video: HTMLVideoElement) =>
      (video.closest(".group") as HTMLElement).style.aspectRatio;
    const loadSized = (
      video: HTMLVideoElement,
      width: number,
      height: number,
    ) => {
      Object.defineProperty(video, "videoWidth", {
        configurable: true,
        value: width,
      });
      Object.defineProperty(video, "videoHeight", {
        configurable: true,
        value: height,
      });
      loadVideo(video);
    };

    it("starts from the recorded size", () => {
      const { video } = renderPlayer();
      expect(boxOf(video)).toBe("1920 / 1080");
    });

    // A portrait phone video recorded at its stored, pre-rotation size: the
    // element reports it as displayed, and the box must follow.
    it("follows the size the element reports once it has metadata", () => {
      const { video } = renderPlayer();
      loadSized(video, 1080, 1920);
      expect(boxOf(video)).toBe("1080 / 1920");
    });

    it("shapes a file with no recorded size once it has metadata", () => {
      const { video } = renderPlayer({ width: null, height: null });
      expect(boxOf(video)).toBe("16 / 9");
      loadSized(video, 720, 1280);
      expect(boxOf(video)).toBe("720 / 1280");
    });

    // The playlist hands its element over already loaded: no loadedmetadata
    // follows, so the size is read off the element when it is adopted.
    it("takes the size of an element handed over already loaded", () => {
      const first = renderPlayer();
      loadSized(first.video, 1080, 1920);
      Object.defineProperty(first.video, "readyState", {
        configurable: true,
        value: 1,
      });
      announceVideoHandOff("http://127.0.0.1:17345/ws/ws1/media/1");
      cleanup();

      const second = renderPlayer();
      expect(second.video).toBe(first.video);
      expect(boxOf(second.video)).toBe("1080 / 1920");
    });

    it("drops the reported size when the source changes", () => {
      const { video, view } = renderPlayer();
      loadSized(video, 1080, 1920);
      view.rerender(
        <Providers>
          <VideoPlayer
            id={2}
            src="http://127.0.0.1:17345/ws/ws1/media/2"
            duration={60}
            width={1280}
            height={720}
            mediaBase="http://127.0.0.1:17345"
            wsId="ws1"
            startAt={0}
            navKeys={NAV_BINDINGS.normal}
            onNativeDuration={vi.fn()}
            onPlayed={vi.fn()}
            t={(key: string) => key}
          />
        </Providers>,
      );
      expect(boxOf(document.querySelector("video")!)).toBe("1280 / 720");
    });
  });

  it("persists volume changes to localStorage", async () => {
    const { video } = renderPlayer();
    loadVideo(video);

    video.volume = 0.5;
    video.muted = true;
    fireEvent.volumeChange(video);

    expect(localStorage.getItem("meguri.player.volume")).toBe("0.5");
    expect(localStorage.getItem("meguri.player.muted")).toBe("1");
  });

  it("exposes seek via ref handle", () => {
    const { video, ref } = renderPlayer();
    loadVideo(video);

    ref.current?.seek(42);
    expect(video.currentTime).toBe(42);
  });

  describe("holding a seek key", () => {
    /** Press the key `times` times in a row, as a held key repeats. */
    function press(times: number, code = "ArrowRight") {
      for (let i = 0; i < times; i += 1) fireEvent.keyDown(window, { code });
    }

    /** Let any rate-limited follow-up land. */
    async function settle() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("moves on every press when the file can seek itself", async () => {
      // A native seek costs nothing, so holding the key still fast-forwards —
      // and every press counts, where before they measured from the last
      // position a timeupdate happened to report and so all landed on the same
      // second.
      const { video } = renderPlayer();
      loadVideo(video);
      press(5);
      expect(video.currentTime).toBe(25);
      await settle();
      expect(video.currentTime).toBe(25);
    });

    it("lets each seek land before asking for the next one", async () => {
      // Assigning currentTime again mid-seek replaces the request the element
      // was working on. At ~30 presses a second that happens forever: the
      // position runs ahead while no frame is ever decoded, so the picture sits
      // frozen where the run began.
      const { video } = renderPlayer();
      loadVideo(video);
      let seeking = false;
      let at = 0;
      Object.defineProperty(video, "seeking", {
        configurable: true,
        get: () => seeking,
      });
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        get: () => at,
        set: (v: number) => {
          at = v;
          seeking = true;
        },
      });

      press(1);
      expect(at).toBe(5);
      // Still decoding: these presses aim further ahead but must not disturb it.
      press(3);
      expect(at).toBe(5);

      seeking = false;
      fireEvent.seeked(video);
      // The frame landed, so the run's newest target goes in now.
      expect(at).toBe(20);
    });

    it("lets an outright seek win over the run it interrupted", async () => {
      // Clicking the bar (or a scene, or a resumed position) right after a run
      // used to be undone: the run's target was still set, so the seeked
      // handler chased it and dragged playback back there.
      const { video, ref } = renderPlayer();
      loadVideo(video);
      let seeking = false;
      let at = 0;
      Object.defineProperty(video, "seeking", {
        configurable: true,
        get: () => seeking,
      });
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        get: () => at,
        set: (v: number) => {
          at = v;
          seeking = true;
        },
      });

      press(4);
      expect(at).toBe(5);

      ref.current?.seek(90);
      expect(at).toBe(90);
      seeking = false;
      fireEvent.seeked(video);
      expect(at).toBe(90);
    });

    it("keeps counting the presses that follow the first one", async () => {
      const { video } = renderPlayer();
      loadVideo(video);
      press(1);
      expect(video.currentTime).toBe(5);
      press(1);
      expect(video.currentTime).toBe(10);
    });

    it("re-serves a stream at a bounded rate, ending on the target", async () => {
      // Nothing is seekable here (no duration): each seek re-serves the file,
      // which spawns an ffmpeg and calls load() — and load() leaves the element
      // paused with the previous play() aborted. Thirty of those a second is
      // how holding a key ended in a stopped video.
      const { video } = renderPlayer();
      const load = vi.fn();
      Object.defineProperty(video, "load", { configurable: true, value: load });
      Object.defineProperty(video, "play", {
        configurable: true,
        value: vi.fn().mockResolvedValue(undefined),
      });
      fireEvent.loadedMetadata(video);

      press(5);
      // The first press still moves the stream straight away.
      expect(load).toHaveBeenCalledTimes(1);
      await settle();
      expect(load.mock.calls.length).toBeLessThanOrEqual(2);
      expect(video.getAttribute("src")).toContain("?t=25");
    });

    it("waits for metadata rather than re-serving a file it cannot place", async () => {
      // Before metadata there is no way to tell a seekable file from a stream.
      // Guessing "stream" re-served with a `?t=` the server ignores for
      // anything but a remuxed container: playback restarted from the top while
      // the position display claimed otherwise.
      const { video } = renderPlayer();
      const src = video.getAttribute("src");
      press(2);
      await settle();
      expect(video.getAttribute("src")).toBe(src);
      expect(video.currentTime).toBe(0);

      loadVideo(video);
      expect(video.getAttribute("src")).toBe(src);
      expect(video.currentTime).toBe(10);
    });
  });

  it("adds a bookmark at the current position from the control bar", async () => {
    const { video, onAddBookmark } = renderPlayer();
    loadVideo(video);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 15,
      writable: true,
    });
    fireEvent.timeUpdate(video);

    const bookmarkBtn = screen.getByTitle("player.bookmarkAdd");
    fireEvent.click(bookmarkBtn);

    expect(onAddBookmark).toHaveBeenCalledWith(15);
  });

  it("exports the current frame from the control bar, pausing playback first", () => {
    const { video, onExportFrame } = renderPlayer();
    loadVideo(video);
    const pause = vi.fn();
    Object.defineProperty(video, "pause", { configurable: true, value: pause });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 33,
      writable: true,
    });
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByTitle("player.exportFrame"));

    expect(pause).toHaveBeenCalled();
    expect(onExportFrame).toHaveBeenCalledWith(33);
  });

  it("disables the export button while an export is in flight", () => {
    const { video, onExportFrame } = renderPlayer({ exportPending: true });
    loadVideo(video);

    const btn = screen.getByTitle<HTMLButtonElement>("player.exportFrame");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onExportFrame).not.toHaveBeenCalled();
  });

  it("records play via IPC and fires onPlayed once", () => {
    const { video, onPlayed } = renderPlayer({ autoplay: false });
    loadVideo(video);

    fireEvent.play(video);
    fireEvent.play(video);

    expect(fileRecordPlay).toHaveBeenCalledWith(1, "ws1", "browser", 0);
    expect(onPlayed).toHaveBeenCalledTimes(1);
  });

  it("ignores MEDIA_ERR_ABORTED without surfacing the error screen", () => {
    const { video } = renderPlayer();

    fireVideoError(video, 1);

    expect(screen.queryByText("player.playFailed")).toBeNull();
    expect(document.querySelector("video")).not.toBeNull();
  });

  it("auto-reloads once on MEDIA_ERR_NETWORK before metadata, then surfaces the error", () => {
    vi.useFakeTimers();
    try {
      const { video } = renderPlayer();
      const load = vi.fn();
      const play = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(video, "load", { configurable: true, value: load });
      Object.defineProperty(video, "play", { configurable: true, value: play });

      fireVideoError(video, 2);
      expect(screen.queryByText("player.playFailed")).toBeNull();
      expect(load).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(load).toHaveBeenCalledTimes(1);

      fireVideoError(video, 2);
      expect(screen.queryByText("player.playFailed")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resume playback on the network auto-reload when autoplay is off", () => {
    vi.useFakeTimers();
    try {
      const { video } = renderPlayer({ autoplay: false });
      const load = vi.fn();
      const play = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(video, "load", { configurable: true, value: load });
      Object.defineProperty(video, "play", { configurable: true, value: play });

      fireVideoError(video, 2);
      vi.advanceTimersByTime(300);

      expect(load).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not auto-reload on MEDIA_ERR_NETWORK after metadata has loaded", () => {
    const { video } = renderPlayer();
    loadVideo(video);

    fireVideoError(video, 2);

    expect(screen.queryByText("player.playFailed")).not.toBeNull();
  });

  it("remounts the video with the reload button after a fatal error", () => {
    const { video } = renderPlayer();

    fireVideoError(video, 4);
    expect(screen.queryByText("player.playFailed")).not.toBeNull();
    expect(document.querySelector("video")).toBeNull();

    fireEvent.click(screen.getByText("player.reload"));

    expect(screen.queryByText("player.playFailed")).toBeNull();
    expect(document.querySelector("video")).not.toBeNull();
  });
  describe("recording where playback stopped", () => {
    beforeEach(() => {
      fileSavePosition.mockClear();
    });

    /** A loaded element standing at `at`, playing or paused. */
    function standAt(video: HTMLVideoElement, at: number, paused: boolean) {
      Object.defineProperty(video, "readyState", {
        configurable: true,
        value: 1,
      });
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: paused,
      });
      video.currentTime = at;
    }

    it("reports the position on pause, urgently", () => {
      const { video } = renderPlayer({ autoplay: false });
      loadVideo(video);
      standAt(video, 0, false);
      fireEvent.play(video);
      standAt(video, 42, true);
      fireEvent.pause(video);
      expect(fileSavePosition).toHaveBeenLastCalledWith(1, "ws1", {
        position: 42,
        duration: 120,
        urgent: true,
      });
    });

    it("reports the end as finished", () => {
      const { video } = renderPlayer({ autoplay: false });
      loadVideo(video);
      standAt(video, 0, false);
      fireEvent.play(video);
      standAt(video, 120, true);
      fireEvent.ended(video);
      expect(fileSavePosition).toHaveBeenLastCalledWith(1, "ws1", {
        position: 120,
        duration: 120,
        ended: true,
        urgent: true,
      });
    });

    it("reports where it was left when the player closes", () => {
      const { video, view } = renderPlayer({ autoplay: false });
      loadVideo(video);
      standAt(video, 0, false);
      fireEvent.play(video);
      standAt(video, 30, false);
      fireEvent.timeUpdate(video);
      // Well inside the throttle interval: nothing went out yet.
      expect(fileSavePosition).not.toHaveBeenCalled();
      view.unmount();
      expect(fileSavePosition).toHaveBeenLastCalledWith(1, "ws1", {
        position: 30,
        duration: 120,
        urgent: true,
      });
    });

    it("reports nothing for a file that never played", () => {
      const { video, view } = renderPlayer({ autoplay: false, startAt: 30 });
      loadVideo(video);
      standAt(video, 30, true);
      fireEvent.seeked(video);
      fireEvent.pause(video);
      view.unmount();
      expect(fileSavePosition).not.toHaveBeenCalled();
    });

    it("applies a start position that arrives after the metadata, once", () => {
      const props = {
        id: 1,
        src: "http://127.0.0.1:17345/ws/ws1/media/1",
        duration: 120,
        width: 1920,
        height: 1080,
        mediaBase: "http://127.0.0.1:17345",
        wsId: "ws1",
        autoplay: false,
        navKeys: NAV_BINDINGS.normal,
        onNativeDuration: () => undefined,
        onPlayed: () => undefined,
        t: (key: string) => key,
      };
      const view = render(
        <Providers>
          <VideoPlayer {...props} startAt={0} />
        </Providers>,
      );
      const video = document.querySelector("video") as HTMLVideoElement;
      loadVideo(video);
      expect(video.currentTime).toBe(0);
      view.rerender(
        <Providers>
          <VideoPlayer {...props} startAt={30} />
        </Providers>,
      );
      expect(video.currentTime).toBe(30);
      // Owed once: a later change does not move playback again.
      view.rerender(
        <Providers>
          <VideoPlayer {...props} startAt={60} />
        </Providers>,
      );
      expect(video.currentTime).toBe(30);
    });
  });
});
