// The spectrum display: gated by the preference and the OS reduce-motion
// setting, drawn in the chosen pattern from the analyser while its host's
// track is sounding, drained (not frozen) once it stops, and picked up again
// when it resumes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { AudioSpectrum } from "@/audio/AudioSpectrum";
import { renderWithProviders } from "@/test/renderWithProviders";
import { defaultAppStatus } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ appStatus: vi.fn() }));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
  },
  ALL_ID: "__all__",
}));

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** What the fake analyser reports for every bin on the next read. */
let level = 255;

class FakeContext extends EventTarget {
  state = "running";
  sampleRate = 48_000;
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    connect: vi.fn(),
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 2048,
    context: this,
    getByteFrequencyData: (data: Uint8Array) => data.fill(level),
  }));
}

/** The frames requested since the last flush, run in order by flush() with
 *  the clock advanced one 60 Hz frame each time. */
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let clock = 0;
function flush(): void {
  const batch = [...frames.values()];
  frames = new Map();
  clock += 1000 / 60;
  act(() => batch.forEach((cb) => cb(clock)));
}

/** The bars' rectangles drawn since the last clear: [x, y, w, h]. */
let rects: number[][] = [];
let fills = 0;

function setPrefs(prefs: Record<string, unknown>): void {
  localStorage.setItem("meguri.prefs", JSON.stringify(prefs));
}

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  localStorage.clear();
  level = 255;
  frames = new Map();
  clock = 0;
  rects = [];
  fills = 0;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  // jsdom has no canvas: a minimal 2d context is enough to count what was
  // drawn. No roundRect, so the drawers fall back to rect().
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        setTransform: vi.fn(),
        clearRect: vi.fn(() => {
          rects = [];
        }),
        beginPath: vi.fn(),
        rect: vi.fn((...args: number[]) => {
          rects.push(args);
        }),
        fill: vi.fn(() => {
          fills++;
        }),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        stroke: vi.fn(),
        globalAlpha: 1,
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        lineCap: "butt",
      }) as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 100,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AudioSpectrum", () => {
  it("renders nothing when the preference is off", () => {
    setPrefs({ audioSpectrum: false });
    renderWithProviders(<AudioSpectrum active mode="overlay" />);
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
  });

  it("renders nothing under the OS reduce-motion setting", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderWithProviders(<AudioSpectrum active mode="overlay" />);
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
  });

  it("draws the tile's 14 bars from the analyser while active", () => {
    renderWithProviders(
      <AudioSpectrum active mode="tile" className="absolute inset-0" />,
    );
    const canvas = screen.getByTestId("audio-spectrum");
    // The host sizes the wrapper; the canvas always fills it.
    expect(canvas.parentElement?.className).toContain("absolute inset-0");
    expect(canvas.className).toContain("h-full w-full");
    expect(canvas.dataset.pattern).toBe("bars");
    // Full-scale input, a few frames in: the bars have risen to the top of
    // the tile's band.
    for (let i = 0; i < 20; i++) flush();
    expect(rects).toHaveLength(14);
    const [, , , h] = rects[0];
    expect(h).toBeCloseTo(100 * 0.78, 0);
    // Sounding: the next frame is already requested.
    expect(frames.size).toBe(1);
  });

  it("switches pattern with the preference", () => {
    setPrefs({ audioSpectrumPattern: "led" });
    renderWithProviders(<AudioSpectrum active mode="overlay" />);
    expect(screen.getByTestId("audio-spectrum").dataset.pattern).toBe("led");
    flush();
    // The overlay meter is 40 columns of 7 cells, lit or not, batched into
    // one fill per shade.
    expect(rects).toHaveLength(40 * 7);
    expect(fills).toBeLessThanOrEqual(5);
  });

  it("drains after the track stops instead of freezing, and resumes", () => {
    const { rerender } = renderWithProviders(
      <AudioSpectrum active mode="tile" />,
    );
    for (let i = 0; i < 20; i++) flush();
    const [, , , full] = rects[0];

    rerender(<AudioSpectrum active={false} mode="tile" />);
    // The first inactive frame still shows the bars, shorter.
    flush();
    expect(rects).toHaveLength(14);
    const [, , , h] = rects[0];
    expect(h).toBeLessThan(full);
    expect(h).toBeGreaterThan(0);
    // Keeps falling until nothing is left, then stops asking for frames.
    let guard = 0;
    while (frames.size > 0 && guard++ < 300) flush();
    expect(frames.size).toBe(0);
    expect(guard).toBeLessThan(300);
    expect(rects).toHaveLength(0);

    // Sounding again: the loop is kicked back into life without a rebuild.
    rerender(<AudioSpectrum active mode="tile" />);
    expect(frames.size).toBe(1);
    flush();
    expect(rects).toHaveLength(14);
  });

  it("keeps the frames coming while a pattern's own motion plays out", () => {
    setPrefs({ audioSpectrumPattern: "ripple" });
    const { rerender } = renderWithProviders(
      <AudioSpectrum active mode="full" />,
    );
    // Loud for a while: the kicks have thrown a few rings.
    for (let i = 0; i < 30; i++) flush();
    rerender(<AudioSpectrum active={false} mode="full" />);
    // The levels drain in about a second; the rings live longer than that,
    // so the loop is still running well after.
    for (let i = 0; i < 90; i++) flush();
    expect(frames.size).toBe(1);
    // ...and rests once the last ring has faded.
    let guard = 0;
    while (frames.size > 0 && guard++ < 300) flush();
    expect(frames.size).toBe(0);
    expect(guard).toBeLessThan(300);
  });

  it("skips bands above Nyquist instead of reading past the data", () => {
    // 8 kHz output: Nyquist is 4 kHz, well under the 16 kHz top band.
    class Narrow extends FakeContext {
      override sampleRate = 8_000;
    }
    vi.stubGlobal("AudioContext", Narrow);
    renderWithProviders(<AudioSpectrum active mode="overlay" />);
    for (let i = 0; i < 20; i++) flush();
    expect(rects).toHaveLength(48);
    // Every bar has a finite height; the ones above Nyquist are the 2px
    // stubs an active display keeps, not NaN.
    for (const [, , , h] of rects) expect(Number.isFinite(h)).toBe(true);
    expect(rects.some(([, , , h]) => h === 2)).toBe(true);
    expect(rects.some(([, , , h]) => h > 2)).toBe(true);
  });

  it("still plays (no throw) where Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    renderWithProviders(<AudioSpectrum active mode="overlay" />);
    expect(screen.queryByTestId("audio-spectrum")).not.toBeNull();
    flush();
    expect(fills).toBe(0);
  });
});
