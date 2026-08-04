// Rendering and accessibility tests for the bottom player bar. Playback behaviour
// itself is covered in AudioPlayerProvider.test.tsx; here the concern is what the
// bar shows and whether every control is reachable and operable by keyboard.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AudioPlayerProvider } from "@/audio/AudioPlayerProvider";
import { AudioPlayerBar } from "@/audio/AudioPlayerBar";
import { useAudioPlayer } from "@/audio/useAudioPlayer";
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

let el: HTMLAudioElement;

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  mocks.fileRecordPlay.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
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

/** Renders the bar plus a hidden control that loads a track into it. */
function Harness() {
  const { play } = useAudioPlayer();
  return (
    <>
      <button onClick={() => play(sampleAudioRow, WS_ID)}>
        activate-track
      </button>
      <AudioPlayerBar />
    </>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <AudioPlayerProvider>{children}</AudioPlayerProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function setup() {
  render(<Harness />, { wrapper: Wrapper });
}

function loadTrack() {
  fireEvent.click(screen.getByText("activate-track"));
}

function setDuration(sec: number) {
  Object.defineProperty(el, "duration", { value: sec, configurable: true });
  act(() => {
    el.dispatchEvent(new Event("loadedmetadata"));
  });
}

const bar = () => screen.queryByRole("region", { name: /audio player/i });

describe("AudioPlayerBar", () => {
  it("renders nothing when no track is loaded", () => {
    setup();
    expect(bar()).toBeNull();
  });

  it("shows the filename, time readout, and controls once a track is loaded", () => {
    setup();
    loadTrack();
    expect(bar()).toBeTruthy();
    // The filename, not the full relative path.
    expect(screen.getByText("track.mp3")).toBeTruthy();
    setDuration(240);
    expect(screen.getByText(/0:00/)).toBeTruthy();
    expect(screen.getByText(/4:00/)).toBeTruthy();
  });

  it("renders --:-- and disables seeking when the duration is unknown", () => {
    setup();
    loadTrack();
    setDuration(NaN);
    expect(screen.getByText(/--:--/)).toBeTruthy();
    const seek = screen.getByRole("slider", { name: /seek/i });
    expect((seek as HTMLInputElement).disabled).toBe(true);
  });

  it("enables the seek slider and reports its range once the duration is known", () => {
    setup();
    loadTrack();
    setDuration(240);
    const seek = screen.getByRole("slider", {
      name: /seek/i,
    }) as HTMLInputElement;
    expect(seek.disabled).toBe(false);
    // A native range input carries valuemin/valuemax/valuenow implicitly.
    expect(seek.min).toBe("0");
    expect(seek.max).toBe("240");
    expect(seek.getAttribute("aria-valuetext")).toContain("4:00");
  });

  it("exposes every control as a focusable element (keyboard reachable)", () => {
    setup();
    loadTrack();
    setDuration(240);
    const region = bar()!;
    const controls = region.querySelectorAll("button, input");
    // play/pause, seek, mute, volume, close.
    expect(controls.length).toBe(5);
    for (const c of controls) {
      // Real elements, natively focusable, never removed from the tab order.
      expect(["BUTTON", "INPUT"]).toContain(c.tagName);
      expect(c.getAttribute("tabindex")).not.toBe("-1");
      (c as HTMLElement).focus();
      expect(document.activeElement).toBe(c);
    }
  });

  it("labels the play control by the action it performs", () => {
    setup();
    loadTrack();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("replaces the seek area with a dismissible message on a playback error", () => {
    setup();
    loadTrack();
    setDuration(240);
    act(() => {
      el.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText(/could not be played/i)).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /seek/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /dismiss error/i }));
    expect(screen.queryByText(/could not be played/i)).toBeNull();
    expect(screen.getByRole("slider", { name: /seek/i })).toBeTruthy();
  });

  it("publishes its height so bottom-anchored overlays can clear it", () => {
    const varOf = () =>
      document.documentElement.style.getPropertyValue("--meguri-player-bar-h");
    setup();
    // Nothing loaded: overlays keep their original offset.
    expect(varOf()).toBe("0px");

    // jsdom reports 0 for every measurement, so assert the wiring by stubbing
    // the measured height rather than expecting a real pixel value.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 48,
    } as DOMRect);
    loadTrack();
    expect(varOf()).toBe("48px");

    fireEvent.click(screen.getByRole("button", { name: /close player/i }));
    expect(varOf()).toBe("0px");
  });

  it("hides the bar again when closed", () => {
    setup();
    loadTrack();
    expect(bar()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close player/i }));
    expect(bar()).toBeNull();
  });
});
