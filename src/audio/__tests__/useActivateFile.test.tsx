// The gesture split for audio: play gestures go to the bottom bar, inspect
// gestures open the detail view silently, and video always navigates.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useActivateFile } from "@/audio/useActivateFile";
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleFileRow,
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

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;
/** The provider's single element, captured so a test can mark it as playing. */
let el: HTMLAudioElement;
function capture(instance: HTMLAudioElement): void {
  el = instance;
}

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockReset().mockResolvedValue(undefined);
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

function Probe() {
  const { activate, onThumbnailClick } = useActivateFile();
  return (
    <div>
      <a href="#/never" onClick={onThumbnailClick(sampleAudioRow)}>
        audio-thumb
      </a>
      <a href="#/never" onClick={onThumbnailClick(sampleFileRow)}>
        video-thumb
      </a>
      <button onClick={() => activate(sampleAudioRow)}>audio-enter</button>
      <button onClick={() => activate(sampleAudioRow, { autoplay: false })}>
        audio-inspect
      </button>
      <button onClick={() => activate(sampleFileRow)}>video-enter</button>
    </div>
  );
}

describe("useActivateFile", () => {
  it("plays audio in the bar from the thumbnail without navigating", () => {
    renderWithProviders(<Probe />, { route: "/" });
    // Prevented: the router never sees the click (jsdom does not follow
    // anchors, so the hash is asserted through defaultPrevented instead).
    expect(fireEvent.click(screen.getByText("audio-thumb"))).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(mocks.fileRecordPlay).toHaveBeenCalledWith(
      sampleAudioRow.id,
      WS_ID,
      "browser",
    );
    expect(window.location.hash).toBe("#/");
  });

  it("leaves a video thumbnail click to the router", () => {
    renderWithProviders(<Probe />, { route: "/" });
    // Not prevented: the <Link> keeps its default navigation.
    expect(fireEvent.click(screen.getByText("video-thumb"))).toBe(true);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("treats Enter on audio as the play gesture, and toggles the loaded track", () => {
    renderWithProviders(<Probe />, { route: "/" });
    fireEvent.click(screen.getByText("audio-enter"));
    expect(playSpy).toHaveBeenCalledTimes(1);
    // jsdom never flips `paused` itself (play() is stubbed), so mark the
    // element as playing the way the real pipeline would have.
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    // Same track again: pause rather than restart from zero.
    fireEvent.click(screen.getByText("audio-enter"));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/");
  });

  it("opens the detail view silently for the inspect gesture", () => {
    renderWithProviders(<Probe />, { route: "/" });
    fireEvent.click(screen.getByText("audio-inspect"));
    expect(playSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(
      `#/file/${sampleAudioRow.id}?ws=${WS_ID}&autoplay=0`,
    );
  });

  it("always opens the detail view for video", () => {
    renderWithProviders(<Probe />, { route: "/" });
    fireEvent.click(screen.getByText("video-enter"));
    expect(playSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(
      `#/file/${sampleFileRow.id}?ws=${sampleFileRow.workspaceId}`,
    );
  });
});
