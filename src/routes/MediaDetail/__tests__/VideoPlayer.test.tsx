import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

function renderPlayer(overrides: Partial<Parameters<typeof VideoPlayer>[0]> = {}) {
  const onAddBookmark = vi.fn();
  const onRemoveBookmark = vi.fn();
  const onExportFrame = vi.fn();
  const onNativeDuration = vi.fn();
  const onPlayed = vi.fn();
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
});
