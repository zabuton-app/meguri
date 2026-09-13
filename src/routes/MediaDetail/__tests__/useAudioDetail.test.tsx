// Auto-start rules of the audio detail view, driven through the hook alone
// (the route's prev/next is a change of `file`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useAudioDetail } from "@/routes/MediaDetail/useAudioDetail";
import type { FileDetail } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleFileDetail,
  WS_ID,
} from "@/test/fixtures";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  fileRecordPlay: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
    fileRecordPlay: (...args: unknown[]): Promise<void> =>
      mocks.fileRecordPlay(...args) as Promise<void>,
  },
  ALL_ID: "__all__",
}));

const audio: FileDetail = {
  ...sampleFileDetail,
  ...sampleAudioRow,
  absPath: "/media/music/track.mp3",
  codec: "mp3",
  fps: null,
};
const video: FileDetail = sampleFileDetail;

let el: HTMLAudioElement;
function capture(instance: HTMLAudioElement): void {
  el = instance;
}
let playSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockReset().mockResolvedValue(undefined);
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

function Probe({ file }: { file: FileDetail }) {
  useAudioDetail({
    file,
    wsId: WS_ID,
    mediaBase: defaultAppStatus.mediaBase,
    autoplay: true,
    startAt: 0,
    pauseVideo: () => {},
  });
  return null;
}

describe("useAudioDetail auto-start", () => {
  it("starts over after prev/next leaves the track and comes back", () => {
    const { rerender } = renderWithProviders(<Probe file={audio} />);
    expect(playSpy).toHaveBeenCalledTimes(1);
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    // Listened partway, then a video interrupted it (paused, still loaded).
    Object.defineProperty(el, "currentTime", {
      value: 42,
      writable: true,
      configurable: true,
    });
    rerender(<Probe file={video} />);
    act(() => {
      el.dispatchEvent(new Event("pause"));
    });

    rerender(<Probe file={audio} />);
    // A fresh start from the top, not a resume from 42 s.
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(el.currentTime).toBe(0);
  });

  it("leaves a track that is still playing alone", () => {
    const { rerender } = renderWithProviders(<Probe file={audio} />);
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    rerender(<Probe file={video} />);
    // Nothing paused it (no video started): coming back must not restart it.
    rerender(<Probe file={audio} />);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
