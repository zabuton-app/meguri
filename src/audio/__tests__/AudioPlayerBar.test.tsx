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
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleAudioRowWithCover,
  WS_ID,
} from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";

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

/** Renders the bar plus hidden controls that load tracks into it. `other` backs
 *  the track-switching tests; it defaults to a second, distinct file. */
function Harness({
  track = sampleAudioRow,
  other = { ...sampleAudioRow, id: 99, relPath: "music/other.mp3" },
}: {
  track?: FileRow;
  other?: FileRow;
}) {
  const { play } = useAudioPlayer();
  return (
    <>
      <button onClick={() => play(track, WS_ID)}>activate-track</button>
      <button onClick={() => play(other, WS_ID)}>activate-other</button>
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

function setup(track?: FileRow, other?: FileRow) {
  render(<Harness track={track} other={other} />, { wrapper: Wrapper });
}

function loadOther() {
  fireEvent.click(screen.getByText("activate-other"));
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

  it("shows the embedded cover art when the track has one", async () => {
    setup(sampleAudioRowWithCover);
    loadTrack();
    // mediaBase arrives with the app status query, so the URL can only be built
    // once that has resolved.
    const img = await screen.findByRole("presentation");
    expect(img.getAttribute("src")).toBe(
      `${defaultAppStatus.mediaBase}/ws/${WS_ID}/thumb/${sampleAudioRowWithCover.id}`,
    );
    // Decorative: the filename beside it already names the track.
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to the music icon for a track with no cover art", () => {
    setup();
    loadTrack();
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(
      bar()?.querySelector("svg.lucide-music, svg[class*='music']"),
    ).toBeTruthy();
  });

  it("falls back to the music icon when the cover image fails to load", async () => {
    setup(sampleAudioRowWithCover);
    loadTrack();
    const img = await screen.findByRole("presentation");
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(
      bar()?.querySelector("svg.lucide-music, svg[class*='music']"),
    ).toBeTruthy();
  });

  it("retries a previously failed cover after switching away and back", async () => {
    // The regression this guards: holding the failure in state that outlives the
    // track (a bare flag, or one keyed on a URL that repeats) would leave the
    // music icon showing forever once a cover had failed even once.
    const other = { ...sampleAudioRowWithCover, id: 99, relPath: "b.mp3" };
    setup(sampleAudioRowWithCover, other);
    loadTrack();
    const first = await screen.findByRole("presentation");
    act(() => {
      fireEvent.error(first);
    });
    expect(screen.queryByRole("presentation")).toBeNull();

    loadOther();
    expect(await screen.findByRole("presentation")).toBeTruthy();

    loadTrack();
    const back = await screen.findByRole("presentation");
    expect(back.getAttribute("src")).toBe(
      `${defaultAppStatus.mediaBase}/ws/${WS_ID}/thumb/${sampleAudioRowWithCover.id}`,
    );
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
