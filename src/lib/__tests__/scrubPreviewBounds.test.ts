import { describe, expect, it } from "vitest";
import { scrubPreviewBounds } from "@/lib/scrubPreviewBounds";

describe("scrubPreviewBounds", () => {
  it("prefers twice the size above the thumbnail when there is room", () => {
    expect(
      scrubPreviewBounds(
        { left: 400, top: 400, width: 200, height: 112.5 },
        { width: 1200, height: 900 },
      ),
    ).toEqual({ left: 300, top: 163, width: 400, height: 225 });
  });

  it.each([
    { left: 0, top: 0, width: 200, height: 112.5 },
    { left: 1000, top: 0, width: 200, height: 112.5 },
    { left: 0, top: 687.5, width: 200, height: 112.5 },
    { left: 1000, top: 687.5, width: 200, height: 112.5 },
    { left: 100, top: 150, width: 200, height: 112.5 },
  ])("stays on screen and clear of its anchor at $left,$top", (anchor) => {
    const bounds = scrubPreviewBounds(anchor, { width: 1200, height: 800 });
    expect(bounds).not.toBeNull();
    expect(bounds!.left).toBeGreaterThanOrEqual(12);
    expect(bounds!.top).toBeGreaterThanOrEqual(12);
    expect(bounds!.left + bounds!.width).toBeLessThanOrEqual(1188);
    expect(bounds!.top + bounds!.height).toBeLessThanOrEqual(788);
    expect(bounds!.width / bounds!.height).toBeCloseTo(
      anchor.width / anchor.height,
    );
    expect(
      bounds!.left >= anchor.left + anchor.width + 12 ||
        bounds!.left + bounds!.width <= anchor.left - 12 ||
        bounds!.top >= anchor.top + anchor.height + 12 ||
        bounds!.top + bounds!.height <= anchor.top - 12,
    ).toBe(true);
  });

  it("uses a side when neither above nor below fits an enlarged preview", () => {
    const bounds = scrubPreviewBounds(
      { left: 20, top: 180, width: 200, height: 112.5 },
      { width: 900, height: 460 },
    );
    expect(bounds!.left).toBe(232);
    expect(bounds!.width).toBe(400);
  });

  it("shrinks in a narrow window without covering the thumbnail", () => {
    const bounds = scrubPreviewBounds(
      { left: 20, top: 20, width: 200, height: 112.5 },
      { width: 360, height: 400 },
    );
    expect(bounds!.width).toBe(336);
    expect(bounds!.top).toBe(144.5);
  });

  it("omits the popup when no enlarged view can fit", () => {
    expect(
      scrubPreviewBounds(
        { left: 0, top: 0, width: 200, height: 112.5 },
        { width: 200, height: 112.5 },
      ),
    ).toBeNull();
  });
});
