import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  computeScrubTime,
  useHoverFramePreview,
} from "@/hooks/useHoverFramePreview";

describe("computeScrubTime", () => {
  it("quantizes to ~20 steps across the duration", () => {
    // step = round(3600 / 20) = 180
    expect(computeScrubTime(3600, 0.5)).toBe(1800);
    expect(computeScrubTime(3600, 0.51)).toBe(1800);
    expect(computeScrubTime(3600, 0.55)).toBe(1980);
  });

  it("clamps fraction to 0..1 and stays inside the video", () => {
    expect(computeScrubTime(3600, -0.5)).toBe(0);
    expect(computeScrubTime(3600, 1.5)).toBe(3599);
    expect(computeScrubTime(3600, 1)).toBe(3599);
  });

  it("handles short and unusable durations", () => {
    expect(computeScrubTime(10, 0.5)).toBe(5);
    expect(computeScrubTime(0.5, 0.5)).toBe(0);
    expect(computeScrubTime(0, 0.5)).toBeNull();
    expect(computeScrubTime(NaN, 0.5)).toBeNull();
  });
});

// jsdom's Image never actually loads, so tests drive onload/onerror by hand.
class MockImage {
  static instances: MockImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = "";
  constructor() {
    MockImage.instances.push(this);
  }
  set src(value: string) {
    this.#src = value;
  }
  get src() {
    return this.#src;
  }
}

const frameUrl = (t: number) => `http://x/frame?t=${t}`;

/** Minimal stand-in for a React mouse event over a 100px-wide thumbnail at x=0. */
function mouseEvt(clientX: number): React.MouseEvent {
  return {
    clientX,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, width: 100 }),
    },
  } as unknown as React.MouseEvent;
}

function renderPreview(
  opts?: Partial<Parameters<typeof useHoverFramePreview>[0]>,
) {
  return renderHook(
    (props: { fileId: number; enabled: boolean }) =>
      useHoverFramePreview({
        enabled: props.enabled,
        frameUrl,
        duration: 3600,
        fileId: props.fileId,
        ...opts,
      }),
    { initialProps: { fileId: 1, enabled: true } },
  );
}

describe("useHoverFramePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the frame at the enter position after the start delay", () => {
    const { result } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    expect(result.current.scrubFraction).toBe(0.5);
    act(() => vi.advanceTimersByTime(299));
    expect(MockImage.instances).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1));
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0].src).toBe(frameUrl(1800));
    act(() => MockImage.instances[0].onload?.());
    expect(result.current.previewSrc).toBe(frameUrl(1800));
  });

  it("tracks pointer moves, keeping a single in-flight request", () => {
    const { result } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(0)));
    act(() => vi.advanceTimersByTime(300));
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0].src).toBe(frameUrl(0));

    // Moves while a frame is in flight only update the desired time.
    act(() => result.current.onMouseMove(mouseEvt(25)));
    act(() => result.current.onMouseMove(mouseEvt(50)));
    expect(MockImage.instances).toHaveLength(1);
    expect(result.current.scrubFraction).toBe(0.5);

    // When the in-flight frame lands, the latest desired time loads next.
    act(() => MockImage.instances[0].onload?.());
    expect(result.current.previewSrc).toBe(frameUrl(0));
    expect(MockImage.instances).toHaveLength(2);
    expect(MockImage.instances[1].src).toBe(frameUrl(1800));
    act(() => MockImage.instances[1].onload?.());
    expect(result.current.previewSrc).toBe(frameUrl(1800));
  });

  it("does not reload when the pointer stays on the same quantized time", () => {
    const { result } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    act(() => vi.advanceTimersByTime(300));
    act(() => MockImage.instances[0].onload?.());
    expect(MockImage.instances).toHaveLength(1);

    // 51px maps to the same 180s-quantized timestamp as 50px.
    act(() => result.current.onMouseMove(mouseEvt(51)));
    expect(MockImage.instances).toHaveLength(1);
  });

  it("resets on mouse leave and stops all timers", () => {
    const { result } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    act(() => vi.advanceTimersByTime(300));
    act(() => MockImage.instances[0].onload?.());
    expect(result.current.previewSrc).not.toBeNull();

    act(() => result.current.onMouseLeave());
    expect(result.current.previewSrc).toBeNull();
    expect(result.current.scrubFraction).toBeNull();
    const count = MockImage.instances.length;
    act(() => vi.advanceTimersByTime(10_000));
    expect(MockImage.instances).toHaveLength(count);
  });

  it("does nothing when disabled", () => {
    const { result } = renderHook(() =>
      useHoverFramePreview({
        enabled: false,
        frameUrl,
        duration: 3600,
        fileId: 1,
      }),
    );
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    act(() => result.current.onMouseMove(mouseEvt(60)));
    act(() => vi.advanceTimersByTime(5000));
    expect(MockImage.instances).toHaveLength(0);
    expect(result.current.previewSrc).toBeNull();
  });

  it("does nothing for unusable durations", () => {
    const { result } = renderPreview({ duration: 0 });
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    act(() => vi.advanceTimersByTime(5000));
    expect(MockImage.instances).toHaveLength(0);
  });

  it("resets when the card is reused for a different file", () => {
    const { result, rerender } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(50)));
    act(() => vi.advanceTimersByTime(300));
    act(() => MockImage.instances[0].onload?.());
    expect(result.current.previewSrc).not.toBeNull();

    const count = MockImage.instances.length;
    rerender({ fileId: 2, enabled: true });
    expect(result.current.previewSrc).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(MockImage.instances).toHaveLength(count);
  });

  it("stops retrying after repeated load failures until the next hover", () => {
    const { result } = renderPreview();
    act(() => result.current.onMouseEnter(mouseEvt(0)));
    act(() => vi.advanceTimersByTime(300));

    // 5 distinct positions each failing exhausts the failure budget.
    for (let i = 0; i < 5; i++) {
      act(() => result.current.onMouseMove(mouseEvt(i * 10)));
      act(() =>
        MockImage.instances[MockImage.instances.length - 1].onerror?.(),
      );
    }
    const count = MockImage.instances.length;
    act(() => result.current.onMouseMove(mouseEvt(90)));
    expect(MockImage.instances).toHaveLength(count);
    expect(result.current.previewSrc).toBeNull();
  });
});
