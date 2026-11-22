// The detail view's zoomable image (#633): Ctrl+wheel zooms the image rather
// than the window, the buttons and a double-click zoom, and a drag pans. The
// stage keeps its size at fit, and a zoomed image fills all of it, the bars
// beside the fitted image included.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ZoomableImage } from "@/routes/MediaDetail/ZoomableImage";

const t = (key: string) => key;

function rect(left: number, width: number, height: number) {
  return () => ({ left, top: 0, width, height }) as DOMRect;
}

// A 2000 × 2000 photo fitted to a 500 × 500 box in the middle of a 1000 × 500
// stage, with 250px bars on either side.
function setup() {
  const view = render(
    <ZoomableImage
      src="media://photo.jpg"
      alt="photo"
      inverted={false}
      t={t as never}
    />,
  );
  const img = screen.getByAltText<HTMLImageElement>("photo");
  const box = img.parentElement as HTMLDivElement;
  const stage = box.parentElement as HTMLDivElement;
  Object.defineProperty(img, "naturalWidth", { value: 2000 });
  Object.defineProperty(img, "naturalHeight", { value: 2000 });
  Object.defineProperty(box, "clientWidth", { value: 500 });
  box.getBoundingClientRect = rect(250, 500, 500);
  stage.getBoundingClientRect = rect(0, 1000, 500);
  fireEvent.load(img);
  return { ...view, img, box, stage };
}

// happy-dom's WheelEvent carries no modifier keys or pointer position, so set
// them on the event itself.
function wheel(
  target: Element,
  init: {
    deltaY: number;
    ctrlKey: boolean;
    clientX?: number;
    clientY?: number;
  },
) {
  const ev = new WheelEvent("wheel", {
    deltaY: init.deltaY,
    bubbles: true,
    cancelable: true,
  });
  for (const [k, v] of Object.entries(init))
    Object.defineProperty(ev, k, { value: v });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

const button = (label: string) =>
  screen.getByLabelText<HTMLButtonElement>(label);
const level = () => screen.getByText(/%$/).textContent;
const pane = () =>
  document.querySelector<HTMLElement>('[data-slot="image-zoom-pane"]');
const zoomedImg = () => pane()?.querySelector("img") as HTMLImageElement;

/** Where the zoomed image is drawn in the stage, in pixels. */
function expectAt(x: number, y: number, size?: number) {
  const img = zoomedImg();
  const m = /^translate\((.+)px, (.+)px\)$/.exec(img.style.transform);
  if (!m) throw new Error(`unexpected transform: ${img.style.transform}`);
  expect(Number(m[1])).toBeCloseTo(x);
  expect(Number(m[2])).toBeCloseTo(y);
  if (size != null) expect(parseFloat(img.style.width)).toBeCloseTo(size);
}

function startDrag(at: { x: number; y: number }) {
  const p = pane() as HTMLElement;
  p.setPointerCapture = () => {};
  fireEvent.pointerDown(p, {
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: at.x,
    clientY: at.y,
  });
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ZoomableImage", () => {
  it("starts at fit and shows the level in actual pixels", () => {
    setup();
    expect(level()).toBe("25%");
    expect(pane()).toBeNull();
    expect(button("media.zoomOut").disabled).toBe(true);
    expect(button("media.zoomFit").disabled).toBe(true);
  });

  it("zooms with Ctrl+wheel toward the pointer, and the window does not zoom", () => {
    const { box, img } = setup();
    const onWindowWheel = vi.fn();
    window.addEventListener("wheel", onWindowWheel);
    try {
      // The fitted image's lower right corner.
      wheel(box, { deltaY: -100, ctrlKey: true, clientX: 750, clientY: 500 });
    } finally {
      window.removeEventListener("wheel", onWindowWheel);
    }
    expect(onWindowWheel).not.toHaveBeenCalled();
    expect(level()).toBe("30%");
    // 600 × 600: narrower than the stage, so centered across it; taller, so
    // its lower edge stays under the pointer.
    expectAt(200, -100, 600);
    // The fitted image keeps the stage at its size.
    expect(img.className).toContain("invisible");
  });

  it("fills the bars beside the fitted image once it is wide enough", () => {
    const { box } = setup();
    // Actual pixels at the fitted image's center: 2000 × 2000 over the stage.
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    expect(level()).toBe("100%");
    expectAt(-500, -750, 2000);
  });

  it("leaves a plain wheel to scroll the detail view, zoomed or not", () => {
    const { box, stage } = setup();
    expect(wheel(box, { deltaY: -100, ctrlKey: false }).defaultPrevented).toBe(
      false,
    );
    fireEvent.click(button("media.zoomIn"));
    expect(
      wheel(stage, { deltaY: -100, ctrlKey: false }).defaultPrevented,
    ).toBe(false);
  });

  it("leaves Ctrl+wheel to the window while the image has not loaded", () => {
    render(
      <ZoomableImage
        src="media://broken.jpg"
        alt="broken"
        inverted={false}
        t={t as never}
      />,
    );
    const box = screen.getByAltText("broken").parentElement as HTMLElement;
    const ev = wheel(box, { deltaY: -100, ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("zooms the image with Ctrl+wheel over its buttons too", () => {
    setup();
    const ev = wheel(button("media.zoomIn"), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 900,
      clientY: 450,
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(level()).toBe("30%");
  });

  it("zooms with the buttons and goes back to fit, keeping the focus", () => {
    setup();
    const zoomIn = button("media.zoomIn");
    zoomIn.focus();
    fireEvent.click(zoomIn);
    expect(level()).toBe("31%");
    expect(pane()).not.toBeNull();
    expect(document.activeElement).toBe(zoomIn);
    fireEvent.click(button("media.zoomFit"));
    expect(level()).toBe("25%");
    expect(pane()).toBeNull();
  });

  it("goes back to fit when zoomed out past it", () => {
    setup();
    fireEvent.click(button("media.zoomIn"));
    fireEvent.click(button("media.zoomOut"));
    expect(pane()).toBeNull();
    expect(level()).toBe("25%");
  });

  it("stops zooming in at 800%", () => {
    setup();
    for (let i = 0; i < 20; i++) fireEvent.click(button("media.zoomIn"));
    expect(level()).toBe("800%");
    expect(button("media.zoomIn").disabled).toBe(true);
  });

  it("goes back to fit on a double-click while zoomed in", () => {
    const { box } = setup();
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    fireEvent.doubleClick(pane() as HTMLElement);
    expect(pane()).toBeNull();
    expect(level()).toBe("25%");
  });

  it("pans by dragging while zoomed in", () => {
    const { box } = setup();
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    const p = startDrag({ x: 500, y: 250 });
    fireEvent.pointerMove(p, {
      pointerId: 1,
      buttons: 1,
      clientX: 600,
      clientY: 300,
    });
    fireEvent.pointerUp(p, { pointerId: 1 });
    expectAt(-400, -700);
    // Released: further moves do nothing.
    fireEvent.pointerMove(p, {
      pointerId: 1,
      buttons: 1,
      clientX: 900,
      clientY: 400,
    });
    expectAt(-400, -700);
  });

  it("stops panning when the pointer capture is lost without a pointerup", () => {
    const { box } = setup();
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    const p = startDrag({ x: 500, y: 250 });
    fireEvent.lostPointerCapture(p, { pointerId: 1 });
    fireEvent.pointerMove(p, {
      pointerId: 1,
      buttons: 1,
      clientX: 600,
      clientY: 300,
    });
    expectAt(-500, -750);
  });

  it("does not pan on hover after the pane closed mid-drag and opened again", () => {
    const { box, stage } = setup();
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    startDrag({ x: 500, y: 250 });
    // Zoomed out to fit while the button is still down.
    for (let i = 0; i < 10; i++)
      wheel(stage, { deltaY: 100, ctrlKey: true, clientX: 500, clientY: 250 });
    expect(pane()).toBeNull();
    fireEvent.doubleClick(box, { clientX: 500, clientY: 250 });
    fireEvent.pointerMove(pane() as HTMLElement, {
      pointerId: 1,
      buttons: 0,
      clientX: 700,
      clientY: 400,
    });
    expectAt(-500, -750);
  });
});
