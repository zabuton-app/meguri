import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { NAV_BINDINGS } from "@/settings/keybindings";
import {
  VideoPlayer,
  type PlayerHandle,
} from "@/routes/MediaDetail/VideoPlayer";

const fileRecordPlay = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({
  api: {
    fileRecordPlay: (...args: unknown[]) => fileRecordPlay(...args),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

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
  render(
    <I18nProvider>
      <VideoPlayer ref={ref} {...props} />
    </I18nProvider>,
  );

  const video = document.querySelector("video") as HTMLVideoElement;
  return {
    video,
    ref,
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
});
