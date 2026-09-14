import { describe, expect, it, vi } from "vitest";
import {
  bandColors,
  bandCount,
  drawBars,
  drawLed,
  drawRing,
  ledColor,
  mixHex,
  PATTERN_LAYOUT,
  rampColor,
  rgba,
  type SpectrumPalette,
} from "@/audio/spectrumPatterns";

const palette: SpectrumPalette = {
  primary: "#83a598",
  info: "#8ec07c",
  success: "#b8bb26",
  accent2: "#fabd2f",
  warn: "#fe8019",
  secondaryAccent: "#d3869b",
  error: "#fb4934",
  fg: "#ebdbb2",
};

function fakeContext() {
  const rects: number[][] = [];
  /** fillStyle at each fill(), so a test can tell lit cells from unlit. */
  const fillsBy: string[] = [];
  const g = {
    beginPath: vi.fn(),
    rect: vi.fn((...a: number[]) => {
      rects.push(a);
    }),
    fill: vi.fn(() => {
      fillsBy.push(g.fillStyle);
    }),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
  };
  return {
    g: g as unknown as CanvasRenderingContext2D,
    rects,
    fillsBy,
    spies: g,
  };
}

function args(n: number) {
  return { palette, colors: bandColors(palette, n), active: true };
}

describe("colours", () => {
  it("mixes hex colours and reads the ramp's ends", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128,128,128)");
    expect(rampColor(palette, 0)).toBe("rgb(131,165,152)");
    expect(rampColor(palette, 1)).toBe("rgb(211,134,155)");
    expect(rgba("#ebdbb2", 0.07)).toBe("rgba(235,219,178,0.07)");
  });

  it("steps the LED colour by height", () => {
    expect(ledColor(palette, 0.1)).toBe(palette.success);
    expect(ledColor(palette, 0.7)).toBe(palette.accent2);
    expect(ledColor(palette, 0.9)).toBe(palette.warn);
    expect(ledColor(palette, 1)).toBe(palette.error);
  });
});

describe("geometry", () => {
  it("knows how many bands each pattern wants in each mode", () => {
    expect(bandCount("bars", "tile")).toBe(14);
    expect(bandCount("bars", "overlay")).toBe(48);
    expect(bandCount("ring", "tile")).toBe(48);
    expect(bandCount("led", "overlay")).toBe(40);
    expect(bandCount("led", "full")).toBe(30);
  });

  it("puts the bars and the meter along the bottom, the ring over it all", () => {
    expect(PATTERN_LAYOUT.bars.overlayBox).toContain("bottom-0");
    expect(PATTERN_LAYOUT.led.overlayBox).toContain("bottom-0");
    expect(PATTERN_LAYOUT.ring.overlayBox).toBe("absolute inset-0");
    expect(PATTERN_LAYOUT.bars.glyph).toBe("corner");
    expect(PATTERN_LAYOUT.ring.glyph).toBe("center");
  });

  it("colours each band once along the ramp", () => {
    const colors = bandColors(palette, 3);
    expect(colors).toEqual([
      rampColor(palette, 0),
      rampColor(palette, 0.5),
      rampColor(palette, 1),
    ]);
    expect(bandColors(palette, 1)).toEqual([rampColor(palette, 0)]);
  });
});

describe("drawers", () => {
  it("bars: one rounded bar per level, plus a reflection when full", () => {
    const levels = new Float32Array([1, 0.5, 0]);
    const over = fakeContext();
    drawBars({ ...over, ...args(3), w: 300, h: 100, mode: "overlay", levels });
    // Three bars (the silent one as a 2px stub while active).
    expect(over.rects).toHaveLength(3);
    expect(over.rects[0][3]).toBe(94);
    expect(over.rects[1][3]).toBe(47);
    expect(over.rects[2][3]).toBe(2);

    const full = fakeContext();
    drawBars({ ...full, ...args(3), w: 300, h: 100, mode: "full", levels });
    expect(full.rects).toHaveLength(6);

    // Drained and paused: nothing at all, not a row of stubs.
    const idle = fakeContext();
    drawBars({
      ...idle,
      ...args(3),
      active: false,
      w: 300,
      h: 100,
      mode: "overlay",
      levels: new Float32Array(3),
    });
    expect(idle.rects).toHaveLength(0);
  });

  it("ring: one tick per level, round-capped", () => {
    const f = fakeContext();
    drawRing({
      ...f,
      ...args(84),
      w: 300,
      h: 300,
      mode: "full",
      levels: new Float32Array(84),
    });
    expect(f.spies.stroke).toHaveBeenCalledTimes(84);
    expect(f.spies.lineCap).toBe("round");
  });

  it("led: every cell is drawn, lit ones up to the level, one fill per shade", () => {
    const f = fakeContext();
    const levels = new Float32Array(10);
    levels[0] = 1; // one column fully lit: 10 cells through all four shades
    levels[1] = 0.5; // half lit: 5 cells, all in the lowest shade
    drawLed({ ...f, ...args(10), w: 200, h: 120, mode: "tile", levels });
    // 10 x 10 cells, lit or not, in five fills at most (one per shade).
    expect(f.rects).toHaveLength(10 * 10);
    expect(f.fillsBy).toEqual([
      palette.success,
      palette.accent2,
      palette.warn,
      palette.error,
      rgba(palette.fg, 0.07),
    ]);
    // Nothing lit: only the unlit shade is filled.
    const off = fakeContext();
    drawLed({
      ...off,
      ...args(10),
      w: 200,
      h: 120,
      mode: "tile",
      levels: new Float32Array(10),
    });
    expect(off.fillsBy).toEqual([rgba(palette.fg, 0.07)]);
  });
});
