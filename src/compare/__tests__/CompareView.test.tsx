import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow } from "@/ipc/types";
import { CompareView } from "../CompareView";

vi.mock("@/hooks/useAppStatus", () => ({
  useAppStatus: () => ({ data: { mediaBase: "http://127.0.0.1:1" } }),
}));
// The worker's answer: B sits 12 px right of and 3 px above A's corner.
const alignment = {
  status: "done",
  dx: 12,
  dy: -3,
  scale: 1,
  score: 0.95,
};
vi.mock("../useAlignment", () => ({ useAlignment: () => alignment }));
beforeEach(() => {
  localStorage.clear();
  alignment.score = 0.95;
  alignment.scale = 1;
});

const row = (id: number, relPath: string): FileRow => ({
  id,
  workspaceId: "ws-test",
  relPath,
  kind: "image",
  ext: "png",
  size: 2048,
  width: 400,
  height: 300,
  duration: null,
  rating: 0,
  favorite: 0,
  thumbStatus: "done",
  hasThumb: 1,
  capturedAt: null,
  btime: null,
  addedAt: 0,
  lastAccessedAt: null,
  resumePosition: null,
  progress: null,
});

function setup() {
  const onClose = vi.fn();
  renderWithProviders(
    <CompareView
      rows={[row(1, "a/first.png"), row(2, "b/second.png")]}
      onClose={onClose}
    />,
  );
  const status = () =>
    document.querySelector('[data-slot="compare-status"]')?.textContent;
  const layer = (side: "a" | "b") =>
    document.querySelector<HTMLElement>(`[data-slot="compare-layer-${side}"]`)!;
  // Where B's image sits in the box both span: 0 unless it is moved.
  const bLeft = () => layer("b").querySelector("img")!.style.left;
  const align = () => screen.getByRole("button", { name: "Align" });
  return { onClose, status, layer, bLeft, align };
}

describe("CompareView", () => {
  it("shows the offset found, and turns it around on a swap", () => {
    const { status } = setup();
    expect(status()).toBe("Offset +12, -3 px · edge match 95%");
    fireEvent.keyDown(window, { key: "s" });
    expect(status()).toBe("Offset -12, +3 px · edge match 95%");
  });

  it("marks the view as experimental in its title", () => {
    setup();
    expect(
      screen
        .getByRole("heading", { name: /Compare images/ })
        .querySelector('[data-slot="experimental-badge"]'),
    ).not.toBeNull();
  });

  it("names A and B in the order they were selected, swapped on S", () => {
    setup();
    const names = () =>
      screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(names()).toEqual(["first.png", "second.png"]);
    fireEvent.keyDown(window, { key: "s" });
    expect(names()).toEqual(["second.png", "first.png"]);
  });

  it("clips A and B on either side of the slider's split", () => {
    const { layer } = setup();
    expect(layer("a").style.clipPath).toBe("inset(0 50% 0 0)");
    expect(layer("b").style.clipPath).toBe("inset(0 0 0 50%)");
  });

  it("switches modes with 1-4", () => {
    const { layer } = setup();
    fireEvent.keyDown(window, { key: "2" });
    expect(layer("b").style.mixBlendMode).toBe("difference");
    expect(layer("a").style.clipPath).toBe("");
    fireEvent.keyDown(window, { key: "3" });
    expect(layer("b").style.opacity).toBe("0.5");
  });

  it("keeps the keys live while the opacity slider has the focus", () => {
    const { layer } = setup();
    fireEvent.keyDown(window, { key: "3" });
    screen.getByRole("slider", { name: "Opacity of B" }).focus();
    fireEvent.keyDown(window, { key: "2" });
    expect(layer("b").style.mixBlendMode).toBe("difference");
  });

  it("places B at the offset found", () => {
    const { bLeft, align } = setup();
    expect(align().getAttribute("aria-pressed")).toBe("true");
    expect(bLeft()).toBe("12px");
    fireEvent.click(align());
    expect(bLeft()).toBe("0px");
  });

  it("shows a negative correlation as no match, not below 0%", () => {
    alignment.score = -0.2;
    const { status } = setup();
    expect(status()).toContain("edge match 0%");
  });

  it("starts with Align off when the match is unreliable", () => {
    alignment.score = 0.34;
    const { status, bLeft, align } = setup();
    expect(status()).toContain("low edge match");
    expect(align().getAttribute("aria-pressed")).toBe("false");
    expect(bLeft()).toBe("0px");
    // Still the user's to turn on.
    fireEvent.click(align());
    expect(align().getAttribute("aria-pressed")).toBe("true");
    expect(bLeft()).toBe("12px");
  });

  it("compares only where the two overlap, and dims the rest", () => {
    // Both 400×300, B at (12, -3): they overlap over A's x 12–400, y 0–297.
    const { layer } = setup();
    const clip = (side: "a" | "b") =>
      layer(side).querySelector("img")!.style.clipPath;
    expect(clip("a")).toBe("inset(0px 0px 3px 12px)");
    expect(clip("b")).toBe("inset(3px 12px 0px 0px)");
    // Beneath, both whole and uncut, dimmed.
    const context = document.querySelector<HTMLElement>(
      '[data-slot="compare-context"]',
    )!;
    expect(context.style.opacity).toBe("0.35");
    const whole = context.querySelectorAll("img");
    expect(whole).toHaveLength(2);
    for (const img of whole) expect(img.style.clipPath).toBe("");
  });

  it("draws B at the scale found, and inverts it on a swap", () => {
    alignment.scale = 2;
    const { status, layer } = setup();
    expect(status()).toBe("Offset +12, -3 px · edge match 95% · scale ×2.00");
    const img = () => layer("b").querySelector("img")!.style;
    // 400×300 drawn twice as large.
    expect([img().width, img().height]).toEqual(["800px", "600px"]);
    // Swapped: A = B / 2 - (12, -3) / 2.
    fireEvent.keyDown(window, { key: "s" });
    expect(status()).toBe("Offset -6, +2 px · edge match 95% · scale ×0.50");
    expect([img().width, img().height]).toEqual(["200px", "150px"]);
  });

  it("shrinks to the centred panel and back, at the size the others share", () => {
    setup();
    const panel = () =>
      document.querySelector('[data-slot="modal-panel"]')!.classList;
    expect(panel()).not.toContain("max-w-4xl");
    fireEvent.click(screen.getByRole("button", { name: "Shrink modal" }));
    expect(panel()).toContain("max-w-4xl");
    expect(localStorage.getItem("meguri.media.modalSize")).toContain("small");
    fireEvent.click(screen.getByRole("button", { name: "Enlarge modal" }));
    expect(panel()).not.toContain("max-w-4xl");
    expect(localStorage.getItem("meguri.media.modalSize")).toContain("large");
  });

  it("closes on Esc", () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// Zoom and pan as in the file details (#647): Ctrl+wheel, a double-click
// between fit and actual pixels, and a pan clamped at the edges.
describe("CompareView zoom and pan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The box both images span is 412 × 303 (B 12 px right of and 3 px above
  // A); in a 206 × 303 stage it fits at 50%.
  function setupStage() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const size =
          this.dataset.slot === "compare-stage"
            ? { width: 206, height: 303 }
            : { width: 0, height: 0 };
        return { left: 0, top: 0, ...size } as DOMRect;
      },
    );
    const r = setup();
    const stage = document.querySelector<HTMLElement>(
      '[data-slot="compare-stage"]',
    )!;
    const level = () => screen.getByText(/^\d+%$/).textContent;
    const box = () => r.layer("a").firstElementChild as HTMLElement;
    return { ...r, stage, level, box };
  }

  // happy-dom's WheelEvent carries no modifier keys or pointer position.
  function wheel(target: Element, init: { deltaY: number; ctrlKey: boolean }) {
    const ev = new WheelEvent("wheel", {
      deltaY: init.deltaY,
      bubbles: true,
      cancelable: true,
    });
    for (const [k, v] of Object.entries({
      ...init,
      clientX: 103,
      clientY: 151,
    }))
      Object.defineProperty(ev, k, { value: v });
    act(() => {
      target.dispatchEvent(ev);
    });
    return ev;
  }

  it("zooms with Ctrl+wheel and leaves a plain wheel alone", () => {
    const { stage, level } = setupStage();
    expect(level()).toBe("50%");
    expect(
      wheel(stage, { deltaY: -100, ctrlKey: false }).defaultPrevented,
    ).toBe(false);
    expect(level()).toBe("50%");
    expect(wheel(stage, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(level()).toBe("60%");
  });

  it("toggles fit and actual pixels on a double-click", () => {
    const { stage, level, box } = setupStage();
    fireEvent.doubleClick(stage, { clientX: 103, clientY: 151 });
    expect(level()).toBe("100%");
    // 412 wide in a 206 stage, centred on the point double-clicked.
    expect(box().style.transform).toBe("translate(-103px, 0px) scale(1)");
    fireEvent.doubleClick(stage, { clientX: 103, clientY: 151 });
    expect(level()).toBe("50%");
  });

  it("goes back to fit on a swap, whose A counts the zoom in other pixels", () => {
    const { stage, level } = setupStage();
    fireEvent.doubleClick(stage, { clientX: 103, clientY: 151 });
    expect(level()).toBe("100%");
    fireEvent.keyDown(window, { key: "s" });
    expect(level()).toBe("50%");
  });

  it("pans by dragging while zoomed in, and stops at the edges", () => {
    const { stage, box } = setupStage();
    fireEvent.doubleClick(stage, { clientX: 103, clientY: 151 });
    stage.setPointerCapture = () => {};
    fireEvent.pointerDown(stage, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 1,
      buttons: 1,
      clientX: 150,
      clientY: 150,
    });
    expect(box().style.transform).toBe("translate(-53px, 0px) scale(1)");
    fireEvent.pointerMove(stage, {
      pointerId: 1,
      buttons: 1,
      clientX: 1000,
      clientY: 150,
    });
    expect(box().style.transform).toBe("translate(0px, 0px) scale(1)");
  });
});
