import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bandColors,
  bandCount,
  createDrawer,
  createArea,
  createOrbs,
  createParticles,
  createRidge,
  createRipple,
  cycleSpectrumPattern,
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
  withAlpha,
  type SpectrumPalette,
  type SpectrumPattern,
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
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
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
    // The ramp yields rgb() strings; withAlpha takes those and hex alike.
    expect(withAlpha("rgb(131,165,152)", 0)).toBe("rgba(131,165,152,0)");
    expect(withAlpha("#ebdbb2", 0.5)).toBe("rgba(235,219,178,0.5)");
    expect(withAlpha("rgb(255 0 0)", 0.5)).toBe("rgba(255,0,0,0.5)");
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

  it("cycles through the patterns in settings order, wrapping", () => {
    expect(cycleSpectrumPattern("bars", 1)).toBe("ring");
    expect(cycleSpectrumPattern("bars", -1)).toBe("barcode");
    expect(cycleSpectrumPattern("barcode", 1)).toBe("bars");
    let p: SpectrumPattern = SPECTRUM_PATTERN_OPTIONS[0];
    for (let i = 0; i < SPECTRUM_PATTERN_OPTIONS.length; i++)
      p = cycleSpectrumPattern(p, 1);
    expect(p).toBe(SPECTRUM_PATTERN_OPTIONS[0]);
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

  it("area: two gradient-filled, stroked layers, the gradients made once", () => {
    const f = fakeContext();
    const draw = createArea();
    const frame = () =>
      draw({
        ...f,
        ...args(40),
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(40, 0.5),
      });
    expect(frame()).toBe(false);
    expect(f.spies.createLinearGradient).toHaveBeenCalledTimes(2);
    expect(f.spies.fill).toHaveBeenCalledTimes(2);
    expect(f.spies.stroke).toHaveBeenCalledTimes(2);
    expect(f.spies.closePath).toHaveBeenCalledTimes(2);
    // The next frame reuses them (they depend on the box and the theme).
    frame();
    expect(f.spies.createLinearGradient).toHaveBeenCalledTimes(2);
    expect(f.spies.fill).toHaveBeenCalledTimes(4);
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
    // Sparks are filled in batches (band colour × alpha step), never one by
    // one: far fewer fills than arcs.
    f.spies.arc.mockClear();
    f.spies.fill.mockClear();
    draw({ ...f, ...args(24), w: 300, h: 100, mode: "full", levels: loud });
    expect(f.spies.fill.mock.calls.length).toBeLessThan(
      f.spies.arc.mock.calls.length,
    );
    expect(f.spies.fill.mock.calls.length).toBeLessThanOrEqual(24 * 4);
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

  it("ridge: keeps a history of rows, cuts each body out and recedes when quiet", () => {
    const draw = createRidge();
    const f = fakeContext();
    // The first frame seeds one row; each 70 ms adds another, up to 10.
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
    expect(f.spies.stroke).toHaveBeenCalledTimes(10);
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
    expect(frames).toBeGreaterThanOrEqual(9);
    expect(frames).toBeLessThan(100);
  });

  it("ripple: a ring on the kick, outliving the sound", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const draw = createRipple();
    const f = fakeContext();
    const loud = flat(24, 1);
    // Two kicks: at t = 0 and, past the 0.88 s gap, at t = 1.
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
      t: 0.4,
      w: 300,
      h: 100,
      mode: "full",
      levels: loud,
    });
    draw({
      ...f,
      ...args(24),
      t: 1,
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

  it("orbs: one glowing sphere per band with a core, the glows made once", () => {
    const f = fakeContext();
    const draw = createOrbs();
    const n = 18;
    // The host hands the same colours array every frame; so does this.
    const shared = args(n);
    const frame = () =>
      draw({
        ...f,
        ...shared,
        w: 300,
        h: 100,
        mode: "full",
        levels: flat(n, 0.5),
      });
    frame();
    // One unit gradient per band colour, fading to that colour (not white).
    expect(f.spies.createRadialGradient).toHaveBeenCalledTimes(n);
    const stops = f.spies.createRadialGradient.mock.results[0].value as {
      addColorStop: ReturnType<typeof vi.fn>;
    };
    expect(stops.addColorStop).toHaveBeenLastCalledWith(
      1,
      withAlpha(rampColor(palette, 0), 0),
    );
    expect(f.spies.arc).toHaveBeenCalledTimes(2 * n);
    expect(f.spies.fillStyle).toBe(palette.fg);
    // The next frame draws the same glows under a transform, building none.
    frame();
    expect(f.spies.createRadialGradient).toHaveBeenCalledTimes(n);
    expect(f.spies.translate).toHaveBeenCalledTimes(2 * n);
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
