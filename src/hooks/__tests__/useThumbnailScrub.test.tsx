import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useThumbnailScrub } from "@/hooks/useThumbnailScrub";

class MockImage {
  static instances: MockImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    MockImage.instances.push(this);
  }
}

function Harness({ fileId = "workspace:1", enabled = true }) {
  const { ref, clean, enlargedBounds, previewSrc } = useThumbnailScrub({
    fileId,
    enabled,
    duration: 100,
    frameUrl: (t) => `http://x/frame/${fileId}?t=${t}`,
  });
  return (
    <div data-testid="surface" data-scrub-surface>
      <button>Overlay control</button>
      <div
        ref={ref}
        data-testid="image"
        data-clean={String(clean)}
        data-popup={JSON.stringify(enlargedBounds)}
        data-preview={previewSrc ?? ""}
      />
    </div>
  );
}

describe("useThumbnailScrub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 112.5,
      right: 300,
      bottom: 212.5,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("upgrades the frame source on enlargement without changing popup dimensions or parallel loading", () => {
    const { getByTestId } = render(<Harness />);
    const surface = getByTestId("surface");
    const image = getByTestId("image");
    fireEvent.mouseEnter(surface, { clientX: 200 });
    void act(() => vi.advanceTimersByTime(300));
    expect(MockImage.instances).toHaveLength(1);
    void act(() => MockImage.instances[0].onload?.());
    const src = image.dataset.preview;
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    expect(image.dataset.clean).toBe("true");
    expect(image.dataset.popup).toBe("null");
    fireEvent.keyDown(window, { key: "Meta", altKey: true, metaKey: true });
    expect(image.dataset.popup).not.toBe("null");
    const bounds = image.dataset.popup;
    fireEvent.mouseMove(surface, { clientX: 202, altKey: true, metaKey: true });
    expect(image.dataset.popup).toBe(bounds);
    expect(image.dataset.preview).toBe(src);
    expect(MockImage.instances).toHaveLength(2);
    expect(MockImage.instances[1].src).toContain("q=enlarged");
    void act(() => MockImage.instances[1].onload?.());
    expect(image.dataset.preview).toContain("q=enlarged");
    expect(image.dataset.popup).toBe(bounds);
    fireEvent.keyUp(window, { key: "Meta", altKey: true });
    expect(image.dataset.popup).toBe("null");
    expect(image.dataset.clean).toBe("true");
    fireEvent.keyUp(window, { key: "Alt" });
    expect(image.dataset.clean).toBe("false");
  });

  it("uses the whole surface even when entered over an overlay, and supports Ctrl+Alt", () => {
    const { getByRole, getByTestId } = render(<Harness />);
    fireEvent.mouseEnter(getByTestId("surface"), {
      clientX: 250,
      altKey: true,
      ctrlKey: true,
    });
    fireEvent.mouseMove(getByRole("button"), {
      clientX: 250,
      altKey: true,
      ctrlKey: true,
    });
    expect(getByTestId("image").dataset.clean).toBe("true");
    expect(getByTestId("image").dataset.popup).not.toBe("null");
    void act(() => vi.advanceTimersByTime(300));
    expect(MockImage.instances[0].src).toContain("t=75");
  });

  it.each(["mouseleave", "blur", "resize", "scroll", "Escape"])(
    "dismisses on %s and cancels pending work",
    (event) => {
      const { getByTestId } = render(<Harness />);
      const surface = getByTestId("surface");
      fireEvent.mouseEnter(surface, {
        clientX: 200,
        altKey: true,
        metaKey: true,
      });
      if (event === "mouseleave") fireEvent.mouseLeave(surface);
      else if (event === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else fireEvent(window, new Event(event));
      expect(getByTestId("image").dataset.clean).toBe("false");
      expect(getByTestId("image").dataset.popup).toBe("null");
      void act(() => vi.advanceTimersByTime(1000));
      expect(MockImage.instances).toHaveLength(0);
      fireEvent.keyDown(window, { key: "Alt", altKey: true });
      expect(getByTestId("image").dataset.clean).toBe("false");
    },
  );

  it("cleans up when a card is recycled into another workspace or disabled", () => {
    const { getByTestId, rerender } = render(<Harness />);
    const surface = getByTestId("surface");
    fireEvent.mouseEnter(surface, {
      clientX: 200,
      altKey: true,
      metaKey: true,
    });
    void act(() => vi.advanceTimersByTime(300));
    rerender(<Harness fileId="other-workspace:1" />);
    expect(MockImage.instances[0].src).toBe("data:,");
    expect(getByTestId("image").dataset.clean).toBe("false");
    fireEvent.mouseLeave(surface);
    fireEvent.mouseEnter(surface, { clientX: 200, altKey: true });
    rerender(<Harness fileId="other-workspace:1" enabled={false} />);
    expect(getByTestId("image").dataset.clean).toBe("false");
    void act(() => vi.advanceTimersByTime(1000));
    expect(MockImage.instances).toHaveLength(1);
  });
});
