// The Web Audio tap: built once per element, wired element → analyser →
// speakers, absent (not broken) where Web Audio does not exist, and kept in
// step with the element's own play/pause from inside.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachAnalyser,
  SPECTRUM_FFT_SIZE,
  SUSPEND_AFTER_MS,
} from "@/audio/analyser";

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const created: FakeContext[] = [];

class FakeContext extends EventTarget {
  state: "running" | "suspended" | "closed" = "running";
  sampleRate = 48_000;
  destination = { kind: "destination" };
  source = { connect: vi.fn() };
  analyser = { connect: vi.fn(), fftSize: 0, smoothingTimeConstant: 0 };
  resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = "suspended";
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  createMediaElementSource = vi.fn(() => this.source);
  createAnalyser = vi.fn(() => this.analyser);
  constructor() {
    super();
    created.push(this);
  }
}

/** A fresh element with `paused` under the test's control. */
function element(paused = true): HTMLAudioElement {
  const el = new Audio();
  Object.defineProperty(el, "paused", {
    configurable: true,
    get: () => paused,
  });
  return el;
}

function emit(el: HTMLMediaElement, type: string): void {
  el.dispatchEvent(new Event(type));
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("AudioContext", FakeContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("attachAnalyser", () => {
  it("routes the element through an analyser to the speakers", () => {
    const el = element();
    const analyser = attachAnalyser(el);
    expect(created).toHaveLength(1);
    const ctx = created[0];
    expect(analyser).toBe(ctx.analyser);
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(el);
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(ctx.analyser.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.analyser.fftSize).toBe(SPECTRUM_FFT_SIZE);
  });

  it("wires the analyser to the speakers before the point of no return", () => {
    // Order matters: once the source exists the element only sounds through
    // the graph, so its output side has to be in place already.
    const el = element();
    attachAnalyser(el);
    const ctx = created[0];
    expect(ctx.analyser.connect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.createMediaElementSource.mock.invocationCallOrder[0],
    );
  });

  it("builds one graph per element and hands back the same analyser", () => {
    const el = element();
    const first = attachAnalyser(el);
    const second = attachAnalyser(el);
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
    expect(created[0].createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("is null where Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(attachAnalyser(element())).toBeNull();
  });

  it("closes the context, remembers the failure and does not retry", () => {
    class Broken extends FakeContext {
      override createMediaElementSource = vi.fn(() => {
        throw new Error("already connected");
      });
    }
    vi.stubGlobal("AudioContext", Broken);
    const el = element();
    expect(attachAnalyser(el)).toBeNull();
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(attachAnalyser(el)).toBeNull();
    expect(created).toHaveLength(1);
  });

  it("falls back to a direct connection when the analyser cannot be inserted", () => {
    // The element is already rerouted at that point; leaving it dangling
    // would mute it, so it goes straight to the speakers and there is simply
    // no spectrum.
    class Stubborn extends FakeContext {
      override source = {
        connect: vi.fn((node: unknown) => {
          if (node === this.analyser) throw new Error("no");
        }),
      };
    }
    vi.stubGlobal("AudioContext", Stubborn);
    const el = element();
    expect(attachAnalyser(el)).toBeNull();
    const ctx = created[0];
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.close).not.toHaveBeenCalled();
    // Still one graph: the fallback is remembered, not rebuilt.
    expect(attachAnalyser(el)).toBeNull();
    expect(created).toHaveLength(1);
  });

  it("wakes a context that starts suspended while the element is sounding", () => {
    class Suspended extends FakeContext {
      override state = "suspended" as const;
    }
    vi.stubGlobal("AudioContext", Suspended);
    attachAnalyser(element(false));
    expect(created[0].resume).toHaveBeenCalledTimes(1);
  });
});

describe("the tap's lifecycle", () => {
  it("resumes a suspended context when the element plays", () => {
    const el = element();
    attachAnalyser(el);
    const ctx = created[0];
    emit(el, "play");
    expect(ctx.resume).not.toHaveBeenCalled();
    ctx.state = "suspended";
    emit(el, "play");
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("suspends the context a while after a pause, but not if playback resumed", () => {
    vi.useFakeTimers();
    const el = element();
    attachAnalyser(el);
    const ctx = created[0];
    emit(el, "pause");
    vi.advanceTimersByTime(SUSPEND_AFTER_MS - 1);
    expect(ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);

    // Play cancels a pending suspend.
    ctx.state = "running";
    emit(el, "pause");
    emit(el, "play");
    vi.advanceTimersByTime(SUSPEND_AFTER_MS);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
  });

  it("puts a context built while the element is paused to sleep on its own", () => {
    // The display mounts before the track starts; without this the context
    // would run until the first pause.
    vi.useFakeTimers();
    attachAnalyser(element(true));
    const ctx = created[0];
    vi.advanceTimersByTime(SUSPEND_AFTER_MS);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
  });

  it("does not suspend while the element is sounding, even after `ended`", () => {
    vi.useFakeTimers();
    const el = element(false);
    attachAnalyser(el);
    const ctx = created[0];
    emit(el, "ended");
    vi.advanceTimersByTime(SUSPEND_AFTER_MS);
    expect(ctx.suspend).not.toHaveBeenCalled();
  });

  it("wakes a context the platform suspended mid-playback", () => {
    const el = element(false);
    attachAnalyser(el);
    const ctx = created[0];
    ctx.state = "suspended";
    ctx.dispatchEvent(new Event("statechange"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });
});
