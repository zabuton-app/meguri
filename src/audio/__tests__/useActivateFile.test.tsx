// The gesture split for audio: play gestures go to the bottom bar, inspect
// gestures open the detail view silently, and video always navigates.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useActivateFile } from "@/audio/useActivateFile";
import { useAudioPlayer } from "@/audio/useAudioPlayer";
import { holdPeekDocked } from "@/routes/MediaDetail/peekDocked";
import { act } from "@testing-library/react";
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
    // Recorded once the element reports that playback is under way.
    act(() => {
      el.dispatchEvent(new Event("playing"));
    });
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

  describe("while the detail is docked as a side peek", () => {
    let release: () => void;
    beforeEach(() => {
      release = holdPeekDocked();
    });
    afterEach(() => {
      release();
    });

    it("moves the peek onto the track instead of playing it from the list", () => {
      renderWithProviders(<Probe />, { route: "/" });
      expect(fireEvent.click(screen.getByText("audio-thumb"))).toBe(false);
      // The peek starts the track on arrival (useAudioDetail), so the list
      // itself must not, or the track would be started twice.
      expect(playSpy).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(
        `#/file/${sampleAudioRow.id}?ws=${WS_ID}`,
      );
    });

    it("treats Enter the same way", () => {
      renderWithProviders(<Probe />, { route: "/" });
      fireEvent.click(screen.getByText("audio-enter"));
      expect(playSpy).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(
        `#/file/${sampleAudioRow.id}?ws=${WS_ID}`,
      );
    });

    it("plays from the bar when the peek already shows the track", () => {
      // The peek is on the track but the bar was closed: the peek will not
      // start it again on the same URL, so the list must.
      renderWithProviders(<Probe />, {
        route: `/file/${sampleAudioRow.id}?ws=${WS_ID}`,
      });
      fireEvent.click(screen.getByText("audio-thumb"));
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe(
        `#/file/${sampleAudioRow.id}?ws=${WS_ID}`,
      );
    });

    it("still toggles the loaded track without moving the peek", () => {
      function Loader() {
        const { play } = useAudioPlayer();
        return (
          <button onClick={() => play(sampleAudioRow, WS_ID)}>load</button>
        );
      }
      renderWithProviders(
        <>
          <Probe />
          <Loader />
        </>,
        { route: "/" },
      );
      // The track is already in the bar (the peek started it earlier).
      fireEvent.click(screen.getByText("load"));
      expect(playSpy).toHaveBeenCalledTimes(1);
      Object.defineProperty(el, "paused", { value: false, configurable: true });
      fireEvent.click(screen.getByText("audio-enter"));
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe("#/");
    });
  });

  it("does not re-render its host when the player's state changes", () => {
    // The hook runs inside memoized virtualized cards: subscribing to the
    // state context there would re-render every visible card on each
    // play/pause/volume step, so it must only ever touch the actions context.
    let hostRenders = 0;
    function Host() {
      hostRenders++;
      useActivateFile();
      return null;
    }
    function Driver() {
      const { play, setVolume, toggleMuted } = useAudioPlayer();
      return (
        <>
          <button onClick={() => play(sampleAudioRow, WS_ID)}>
            drive-play
          </button>
          <button onClick={() => setVolume(0.3)}>drive-volume</button>
          <button onClick={toggleMuted}>drive-mute</button>
        </>
      );
    }
    renderWithProviders(
      <>
        <Host />
        <Driver />
      </>,
    );
    const after_mount = hostRenders;
    act(() => {
      fireEvent.click(screen.getByText("drive-play"));
      fireEvent.click(screen.getByText("drive-volume"));
      fireEvent.click(screen.getByText("drive-mute"));
    });
    expect(hostRenders).toBe(after_mount);
  });
});
