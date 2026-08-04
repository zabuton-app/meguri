// Behavioural tests for the audio player context.
//
// jsdom implements no media pipeline: play()/pause() are absent and currentTime
// never advances on its own. So the element's methods are stubbed and its events
// are dispatched manually, which is also what lets these tests step playback
// state deterministically.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AudioPlayerProvider } from "@/audio/AudioPlayerProvider";
import { useAudioPlayer, useAudioPosition } from "@/audio/useAudioPlayer";
import { defaultAppStatus, sampleAudioRow, WS_ID } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  fileRecordPlay: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
  },
  ALL_ID: "__all__",
}));

/** The single element the provider creates, captured so tests can drive it. */
let el: HTMLAudioElement;
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockReset().mockResolvedValue(undefined);
  localStorage.clear();

  playSpy = vi.fn().mockResolvedValue(undefined);
  pauseSpy = vi.fn();
  // jsdom defines neither play() nor pause() on the prototype. Stub them there
  // rather than intercepting the constructor, so the provider builds its element
  // exactly as it does in production.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    playSpy as unknown as HTMLMediaElement["play"],
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    pauseSpy as unknown as HTMLMediaElement["pause"],
  );
  // Also unimplemented in jsdom; close() calls it to release buffered data.
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  // Capture the instance the provider creates so tests can drive its events.
  const OriginalAudio = window.Audio;
  vi.stubGlobal(
    "Audio",
    class extends OriginalAudio {
      constructor() {
        super();
        el = this;
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Drive the element the way the real media pipeline would. */
function emit(type: string) {
  act(() => {
    el.dispatchEvent(new Event(type));
  });
}

function setDuration(sec: number) {
  Object.defineProperty(el, "duration", {
    value: sec,
    configurable: true,
  });
  emit("loadedmetadata");
}

function setCurrentTime(sec: number) {
  Object.defineProperty(el, "currentTime", {
    value: sec,
    writable: true,
    configurable: true,
  });
  emit("timeupdate");
}

function Probe() {
  const { current, isPlaying, duration, volume, muted, error, ...ctl } =
    useAudioPlayer();
  const position = useAudioPosition();
  return (
    <div>
      <span data-testid="current">{current?.file.relPath ?? "none"}</span>
      <span data-testid="playing">{String(isPlaying)}</span>
      <span data-testid="duration">{String(duration)}</span>
      <span data-testid="position">{String(position)}</span>
      <span data-testid="volume">{String(volume)}</span>
      <span data-testid="muted">{String(muted)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={() => ctl.play(sampleAudioRow, WS_ID)}>play</button>
      <button
        onClick={() =>
          ctl.play({ ...sampleAudioRow, id: 9, relPath: "b.mp3" }, WS_ID)
        }
      >
        play-other
      </button>
      <button onClick={ctl.toggle}>toggle</button>
      <button onClick={ctl.pause}>pause</button>
      <button onClick={() => ctl.seek(30)}>seek-30</button>
      <button onClick={() => ctl.seek(-5)}>seek-negative</button>
      <button onClick={() => ctl.seek(9999)}>seek-past-end</button>
      <button onClick={() => ctl.setVolume(0.25)}>vol-25</button>
      <button onClick={ctl.toggleMuted}>toggle-muted</button>
      <button onClick={ctl.close}>close</button>
      <button onClick={ctl.dismissError}>dismiss</button>
    </div>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AudioPlayerProvider>{children}</AudioPlayerProvider>
    </QueryClientProvider>
  );
}

function setup() {
  render(<Probe />, { wrapper: Wrapper });
}

/** Click a Probe control. */
function click(label: string) {
  fireEvent.click(screen.getByText(label));
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("AudioPlayerProvider", () => {
  it("starts with nothing loaded", () => {
    setup();
    expect(text("current")).toBe("none");
    expect(text("playing")).toBe("false");
    expect(text("duration")).toBe("null");
  });

  it("play() loads the track and starts it", () => {
    setup();
    click("play");
    expect(text("current")).toBe("music/track.mp3");
    expect(playSpy).toHaveBeenCalled();
    expect(el.src).toContain(`/ws/${WS_ID}/media/${sampleAudioRow.id}`);
    emit("play");
    expect(text("playing")).toBe("true");
  });

  it("derives duration and position from element events", () => {
    setup();
    click("play");
    setDuration(240);
    expect(text("duration")).toBe("240");
    setCurrentTime(12.5);
    expect(text("position")).toBe("12.5");
  });

  it("reports an indeterminate duration as null rather than a fabricated value", () => {
    setup();
    click("play");
    setDuration(NaN);
    expect(text("duration")).toBe("null");
  });

  it("toggle() pauses and resumes", () => {
    setup();
    click("play");
    emit("play");

    // Paused state is reported by the element, so mirror what the real one does.
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    click("toggle");
    expect(pauseSpy).toHaveBeenCalled();
    emit("pause");
    expect(text("playing")).toBe("false");

    Object.defineProperty(el, "paused", { value: true, configurable: true });
    playSpy.mockClear();
    click("toggle");
    expect(playSpy).toHaveBeenCalled();
  });

  it("seek() clamps into [0, duration] and assigns currentTime", () => {
    setup();
    click("play");
    setDuration(100);

    click("seek-30");
    expect(el.currentTime).toBe(30);
    expect(text("position")).toBe("30");

    click("seek-negative");
    expect(el.currentTime).toBe(0);

    click("seek-past-end");
    expect(el.currentTime).toBe(100);
  });

  it("a second play() replaces the first track", () => {
    setup();
    click("play");
    expect(text("current")).toBe("music/track.mp3");
    click("play-other");
    expect(text("current")).toBe("b.mp3");
    expect(el.src).toContain("/media/9");
  });

  it("leaves exactly one track playing after rapid successive activation", () => {
    setup();
    click("play");
    click("play-other");
    click("play");
    // A single element makes overlap unrepresentable; the last request wins.
    expect(text("current")).toBe("music/track.mp3");
    expect(el.src).toContain(`/media/${sampleAudioRow.id}`);
  });

  it("stops at the end and stays loaded so the track can be replayed", () => {
    setup();
    click("play");
    setDuration(240);
    emit("play");
    emit("ended");
    expect(text("playing")).toBe("false");
    expect(text("position")).toBe("240");
    // Still loaded: the bar stays visible.
    expect(text("current")).toBe("music/track.mp3");

    // Replay rewinds rather than no-opping at the end.
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    Object.defineProperty(el, "currentTime", {
      value: 240,
      writable: true,
      configurable: true,
    });
    playSpy.mockClear();
    click("toggle");
    expect(el.currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalled();
  });

  it("surfaces a dismissible error when playback fails", () => {
    setup();
    click("play");
    emit("error");
    expect(text("error")).toBe("player.audio.error");
    expect(text("playing")).toBe("false");
    // The track stays loaded and the rest of the app is unaffected.
    expect(text("current")).toBe("music/track.mp3");
    click("dismiss");
    expect(text("error")).toBe("none");
  });

  it("reloads the source when retrying after a failure", () => {
    setup();
    click("play");
    emit("error");
    expect(text("error")).toBe("player.audio.error");

    const loadSpy = vi.spyOn(el, "load");
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    playSpy.mockClear();
    click("toggle");
    // play() alone cannot clear the element's error state, so the retry has to
    // reload the source to stand a chance.
    expect(loadSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    expect(text("error")).toBe("none");
  });

  it("still reloads on retry after the error message was dismissed", () => {
    setup();
    click("play");
    emit("error");
    // Dismissing only hides the message; the element is still on a dead source.
    click("dismiss");
    expect(text("error")).toBe("none");

    const loadSpy = vi.spyOn(el, "load");
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    click("toggle");
    expect(loadSpy).toHaveBeenCalled();
  });

  it("does not surface a stale failure from a track that was already replaced", async () => {
    setup();
    // The first request rejects the way an interrupted load does, but only
    // after a second track has taken over the element.
    let rejectFirst!: (e: Error) => void;
    playSpy.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
    );
    click("play");
    click("play-other");
    rejectFirst(new Error("AbortError"));
    await Promise.resolve();
    await Promise.resolve();

    expect(text("error")).toBe("none");
    expect(text("current")).toBe("b.mp3");
  });

  it("unmutes when the volume slider is moved", () => {
    setup();
    click("play");
    click("toggle-muted");
    expect(text("muted")).toBe("true");

    click("vol-25");
    expect(text("muted")).toBe("false");
    expect(localStorage.getItem("meguri.player.muted")).toBe("0");
  });

  it("close() stops playback and unloads the track", () => {
    setup();
    click("play");
    click("close");
    expect(pauseSpy).toHaveBeenCalled();
    expect(text("current")).toBe("none");
    expect(text("playing")).toBe("false");
    expect(text("position")).toBe("0");
  });

  it("pause() keeps the track loaded (used for video exclusivity)", () => {
    setup();
    click("play");
    click("pause");
    expect(pauseSpy).toHaveBeenCalled();
    // Not closed: the bar stays visible so the user can resume.
    expect(text("current")).toBe("music/track.mp3");
  });

  it("round-trips volume and mute through localStorage", () => {
    setup();
    click("vol-25");
    expect(text("volume")).toBe("0.25");
    expect(localStorage.getItem("meguri.player.volume")).toBe("0.25");

    click("toggle-muted");
    expect(text("muted")).toBe("true");
    expect(localStorage.getItem("meguri.player.muted")).toBe("1");
    expect(el.muted).toBe(true);
  });

  it("records a play-history entry on every activation", () => {
    setup();
    click("play");
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(1);
    expect(mocks.fileRecordPlay).toHaveBeenCalledWith(
      sampleAudioRow.id,
      WS_ID,
      "browser",
    );

    // Re-activating the same track restarts it from the top, so it is a genuine
    // second play and belongs in the history.
    click("play");
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(2);

    click("play-other");
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(3);
  });

  it("does not record a history entry when merely resuming from pause", () => {
    setup();
    click("play");
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(1);

    // Pause, then resume through toggle(): one continuous listen, one entry.
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    click("toggle");
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    click("toggle");
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(1);
  });
});
