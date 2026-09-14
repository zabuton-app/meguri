import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bandColors,
  bandCount,
  createDrawer,
  createLissajous,
  createOrbs,
  createParticles,
  createRidge,
  createRipple,
  drawArea,
  drawBarcode,
  drawBars,
  drawLed,
  drawMirror,
  drawRing,
  drawStrings,
  drawWave,
  ledColor,
  mixHex,
  PATTERN_LAYOUT,
  rampColor,
  rgba,
  SPECTRUM_PATTERN_OPTIONS,
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
  /** The composite operation at each fill(): the ridge cuts its bodies out. */
  const compositeBy: string[] = [];
  /** globalAlpha at each stroke(). */
  const alphaAtStroke: number[] = [];
  const gradient = () => ({ addColorStop: vi.fn() });
  const g = {
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn((...a: number[]) => {
      rects.push(a);
    }),
    fillRect: vi.fn(() => {
      compositeBy.push(g.globalCompositeOperation);
    }),
    fill: vi.fn(() => {
      fillsBy.push(g.fillStyle as string);
      compositeBy.push(g.globalCompositeOperation);
    }),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(() => {
      alphaAtStroke.push(g.globalAlpha);
    }),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(gradient),
    createRadialGradient: vi.fn(gradient),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "" as string | object,
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
  };
  return {
    g: g as unknown as CanvasRenderingContext2D,
    rects,
    fillsBy,
    compositeBy,
    alphaAtStroke,
    spies: g,
  };
}

function args(n: number) {
  return {
    palette,
    colors: bandColors(palette, n),
    active: true,
    t: 0.5,
    dt: 1 / 60,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Levels all at `v`. */
function flat(n: number, v = 0): Float32Array {
  return new Float32Array(n).fill(v);
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
    expect(bandCount("mirror", "tile")).toBe(7);
    expect(bandCount("mirror", "full")).toBe(21);
    expect(bandCount("barcode", "full")).toBe(64);
    for (const p of SPECTRUM_PATTERN_OPTIONS)
      for (const m of ["overlay", "full", "tile"] as const)
        expect(bandCount(p, m)).toBeGreaterThan(1);
  });

  it("has a layout and a drawer for every pattern", () => {
    for (const p of SPECTRUM_PATTERN_OPTIONS) {
      expect(PATTERN_LAYOUT[p].overlayBox).toContain("absolute");
      expect(typeof createDrawer(p)).toBe("function");
    }
    // Stateful drawers are built per display, never shared.
    expect(createDrawer("particles")).not.toBe(createDrawer("particles"));
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

  it("mirror: an odd row of columns, each band twice and the lowest once", () => {
    const f = fakeContext();
    const levels = new Float32Array([1, 0.5, 0, 0, 0, 0, 0]);
    drawMirror({ ...f, ...args(7), w: 300, h: 100, mode: "tile", levels });
    // 13 columns, all drawn (the silent ones as stubs while active).
    expect(f.rects).toHaveLength(13);
    // The centre column is the lowest band at full height, about the middle.
    const centre = f.rects[6];
    expect(centre[3]).toBe(2 * (50 - 6));
    expect(centre[1]).toBe(50 - 44);
    // Its neighbours are the same (half) band.
    expect(f.rects[5][3]).toBe(f.rects[7][3]);
    expect(f.rects[5][3]).toBe(44);
    // Colours run outwards from the centre.
    expect(f.fillsBy[6]).toBe(rampColor(palette, 0));
    expect(f.fillsBy[0]).toBe(rampColor(palette, 1));
  });

  it("wave: the trace and its glow, plus the grid when it is the stage", () => {
    const over = fakeContext();
    drawWave({
      ...over,
      ...args(24),
      w: 300,
      h: 100,
      mode: "overlay",
      levels: flat(24, 1),
    });
    expect(over.spies.stroke).toHaveBeenCalledTimes(2);
    expect(over.spies.strokeStyle).toBe(palette.primary);
    const full = fakeContext();
    drawWave({
      ...full,
      ...args(24),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(24, 1),
    });
    expect(full.spies.stroke).toHaveBeenCalledTimes(3);
  });

  it("area: two gradient-filled, stroked layers", () => {
    const f = fakeContext();
    drawArea({
      ...f,
      ...args(40),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(40, 0.5),
    });
    expect(f.spies.createLinearGradient).toHaveBeenCalledTimes(2);
    expect(f.spies.fill).toHaveBeenCalledTimes(2);
    expect(f.spies.stroke).toHaveBeenCalledTimes(2);
    expect(f.spies.closePath).toHaveBeenCalledTimes(2);
  });

  it("particles: sparks fly while it is loud and keep flying after it stops", () => {
    const draw = createParticles();
    const loud = flat(24, 1);
    const f = fakeContext();
    let busy = false;
    for (let i = 0; i < 10; i++)
      busy =
        draw({
          ...f,
          ...args(24),
          w: 300,
          h: 100,
          mode: "full",
          levels: loud,
        }) === true;
    expect(busy).toBe(true);
    expect(f.spies.arc).toHaveBeenCalled();
    // Silent and stopped: the sparks already up keep falling, then are gone.
    const quiet = fakeContext();
    let frames = 0;
    while (
      draw({
        ...quiet,
        ...args(24),
        active: false,
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(24),
        dt: 0.1,
      }) === true &&
      frames++ < 100
    );
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(100);
  });

  it("strings: one stroke per band, brighter and wider when loud", () => {
    const f = fakeContext();
    const levels = flat(11);
    levels[10] = 1;
    drawStrings({ ...f, ...args(11), w: 300, h: 100, mode: "full", levels });
    expect(f.spies.stroke).toHaveBeenCalledTimes(11);
    // The last string drawn was the loud one: full width and, at the
    // moment of its stroke, full alpha.
    expect(f.spies.lineWidth).toBe(3.5);
    expect(f.alphaAtStroke.at(-1)).toBe(1);
    expect(f.alphaAtStroke[0]).toBeCloseTo(0.35);
  });

  it("lissajous: draws into a fading buffer and keeps the trail alive a moment", () => {
    const buf = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => buf.g,
    );
    const draw = createLissajous();
    const f = fakeContext();
    const on = draw({
      ...f,
      ...args(24),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(24, 0.5),
    });
    expect(on).toBe(true);
    // The fade cuts the buffer's alpha (so the art stays visible under it)
    // before the figure is stroked on top and the buffer is composited.
    expect(buf.spies.fillRect).toHaveBeenCalledTimes(1);
    expect(buf.compositeBy).toEqual(["destination-out"]);
    expect(buf.spies.globalCompositeOperation).toBe("source-over");
    expect(buf.spies.stroke).toHaveBeenCalledTimes(1);
    expect(f.spies.drawImage).toHaveBeenCalledTimes(1);
    // Stopped and drained: a few more frames of fade, then done.
    let frames = 0;
    while (
      draw({
        ...f,
        ...args(24),
        active: false,
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(24),
        dt: 0.1,
      }) === true &&
      frames++ < 100
    );
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(100);
  });

  it("lissajous: draws nothing where canvases have no context, frame after frame", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => null);
    const f = fakeContext();
    const draw = createLissajous();
    for (let i = 0; i < 3; i++)
      expect(
        draw({
          ...f,
          ...args(24),
          w: 300,
          h: 100,
          mode: "full",
          levels: flat(24, 1),
        }),
      ).toBe(false);
    expect(f.spies.drawImage).not.toHaveBeenCalled();
    // One failed attempt is remembered, not retried every frame.
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("lissajous: allocates no buffer while quiet, and lets it go afterwards", () => {
    const buf = fakeContext();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => buf.g);
    const draw = createLissajous();
    const f = fakeContext();
    const quiet = {
      ...f,
      ...args(24),
      active: false,
      w: 300,
      h: 100,
      mode: "full" as const,
      levels: flat(24),
      dt: 0.1,
    };
    // A display of a track that is not sounding (one of many cards).
    expect(draw(quiet)).toBe(false);
    expect(getContext).not.toHaveBeenCalled();
    // Sounding: the buffer exists; quiet again: it is released once the
    // trail is gone, and made anew when the sound returns.
    draw({ ...quiet, active: true, levels: flat(24, 1) });
    expect(getContext).toHaveBeenCalledTimes(1);
    let frames = 0;
    while (draw(quiet) === true && frames++ < 100);
    expect(frames).toBeLessThan(100);
    draw({ ...quiet, active: true, levels: flat(24, 1) });
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it("ridge: keeps a history of rows, cuts each body out and recedes when quiet", () => {
    const draw = createRidge();
    const f = fakeContext();
    // The first frame seeds one row; each 70 ms adds another, up to 16.
    draw({
      ...f,
      ...args(56),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(56, 1),
    });
    expect(f.spies.stroke).toHaveBeenCalledTimes(1);
    expect(f.compositeBy).toEqual(["destination-out"]);
    for (let i = 0; i < 40; i++)
      draw({
        ...f,
        ...args(56),
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(56, 1),
        dt: 0.07,
      });
    f.spies.stroke.mockClear();
    draw({
      ...f,
      ...args(56),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(56, 1),
      dt: 0.07,
    });
    expect(f.spies.stroke).toHaveBeenCalledTimes(16);
    // Stopped: the loud rows recede row by row, and then it is over.
    let frames = 0;
    while (
      draw({
        ...f,
        ...args(56),
        active: false,
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(56),
        dt: 0.07,
      }) === true &&
      frames++ < 100
    );
    expect(frames).toBeGreaterThanOrEqual(15);
    expect(frames).toBeLessThan(100);
  });

  it("ripple: a ring on the kick, outliving the sound", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const draw = createRipple();
    const f = fakeContext();
    const loud = flat(24, 1);
    // Two kicks: at t = 0 and, past the 0.22 s gap, at t = 0.3.
    draw({
      ...f,
      ...args(24),
      t: 0,
      w: 300,
      h: 100,
      mode: "full",
      levels: loud,
    });
    draw({
      ...f,
      ...args(24),
      t: 0.1,
      w: 300,
      h: 100,
      mode: "full",
      levels: loud,
    });
    draw({
      ...f,
      ...args(24),
      t: 0.3,
      w: 300,
      h: 100,
      mode: "full",
      levels: loud,
    });
    // Each ring is two arcs a frame: 1 + 1 + 2 rings across the frames.
    expect(f.spies.arc).toHaveBeenCalledTimes(2 * (1 + 1 + 2));
    let frames = 0;
    while (
      draw({
        ...f,
        ...args(24),
        active: false,
        t: 1 + frames * 0.1,
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(24),
        dt: 0.1,
      }) === true &&
      frames++ < 100
    );
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(100);
  });

  it("orbs: one glowing sphere per band with a core", () => {
    const f = fakeContext();
    createOrbs()({
      ...f,
      ...args(18),
      w: 300,
      h: 100,
      mode: "full",
      levels: flat(18, 0.5),
    });
    expect(f.spies.createRadialGradient).toHaveBeenCalledTimes(18);
    expect(f.spies.arc).toHaveBeenCalledTimes(36);
    expect(f.spies.fillStyle).toBe(palette.fg);
  });

  it("barcode: one hairline per band, heavier when loud", () => {
    const f = fakeContext();
    const levels = flat(64);
    levels[63] = 1;
    drawBarcode({ ...f, ...args(64), w: 300, h: 100, mode: "full", levels });
    expect(f.spies.stroke).toHaveBeenCalledTimes(64);
    expect(f.spies.lineWidth).toBe(5);
  });
});
