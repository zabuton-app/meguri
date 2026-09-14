// The three looks the spectrum display can take, each drawn from the same
// per-band levels (0..1) on a 2D canvas in CSS pixels:
//
// - bars: rounded vertical bars, coloured by frequency along the theme's
//   accent ramp (primary → info → success → accent2 → warn → secondary)
// - ring: radial ticks around a circle in the middle of the box, the same
//   ramp running around the angle
// - led: a dot matrix whose lit rows step through success → accent2 → warn
//   → error like a level meter
//
// A pattern is drawn in one of three modes, which decide its geometry: over
// the cover art on the stage (`overlay`, a band along the bottom edge or the
// whole stage for the ring), instead of missing cover art (`full`, the whole
// stage) or inside the side peek's 120px tile (`tile`).
//
// Everything a pattern is — its choices and default, how many bands it
// wants, how the host lays the artwork out around it, and the drawing — lives
// here, keyed by the pattern so that adding one fails typecheck until every
// table has a row. The drawers themselves stay pure (a context and numbers
// in, nothing else) so they can be tested without a component.

export const SPECTRUM_PATTERN_OPTIONS = ["bars", "ring", "led"] as const;
export type SpectrumPattern = (typeof SPECTRUM_PATTERN_OPTIONS)[number];
export const DEFAULT_SPECTRUM_PATTERN: SpectrumPattern = "bars";

export function isSpectrumPattern(v: unknown): v is SpectrumPattern {
  return SPECTRUM_PATTERN_OPTIONS.includes(v as SpectrumPattern);
}

export type SpectrumMode = "overlay" | "full" | "tile";

/** The theme colours a pattern draws with, as hex strings. */
export interface SpectrumPalette {
  primary: string;
  info: string;
  success: string;
  accent2: string;
  warn: string;
  secondaryAccent: string;
  error: string;
  /** For the unlit LED cells (at a low alpha). */
  fg: string;
}

/** Semantic token → palette field, for reading the `--c-*` variables. */
export const PALETTE_TOKENS: Record<keyof SpectrumPalette, string> = {
  primary: "primary",
  info: "info",
  success: "success",
  accent2: "accent2",
  warn: "warn",
  secondaryAccent: "secondary-accent",
  error: "error",
  fg: "bright-fg",
};

/** How many levels (bands) a pattern needs in a mode. */
export function bandCount(
  pattern: SpectrumPattern,
  mode: SpectrumMode,
): number {
  switch (pattern) {
    case "bars":
      return mode === "tile" ? 14 : 48;
    case "ring":
      return mode === "tile" ? 48 : 84;
    case "led":
      return mode === "tile" ? 10 : mode === "overlay" ? 40 : 30;
  }
}

/** How a host lays its artwork out around a pattern. */
export interface PatternLayout {
  /** Tailwind classes for the box the display fills when laid over the
   *  cover art: a band along the bottom, or the whole stage. The art itself
   *  is shown the same way under every pattern. */
  overlayBox: string;
  /** Where the kind's glyph goes when there is no art: tucked into the
   *  corner because the pattern is the stage, or kept in the middle. */
  glyph: "corner" | "center";
}

export const PATTERN_LAYOUT: Record<SpectrumPattern, PatternLayout> = {
  bars: {
    overlayBox: "absolute bottom-0 left-0 h-[35%] w-full",
    glyph: "corner",
  },
  ring: {
    overlayBox: "absolute inset-0",
    glyph: "center",
  },
  led: {
    overlayBox: "absolute bottom-0 left-0 h-[28%] w-full",
    glyph: "corner",
  },
};

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Colour at `f` (0..1) along the accent ramp. */
export function rampColor(p: SpectrumPalette, f: number): string {
  const stops = [
    p.primary,
    p.info,
    p.success,
    p.accent2,
    p.warn,
    p.secondaryAccent,
  ];
  const x = Math.min(1, Math.max(0, f)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixHex(stops[i], stops[i + 1], x - i);
}

/** Colour of a lit LED cell whose top sits at `frac` (0..1) of the column. */
export function ledColor(p: SpectrumPalette, frac: number): string {
  if (frac < 0.6) return p.success;
  if (frac < 0.8) return p.accent2;
  if (frac < 0.93) return p.warn;
  return p.error;
}

/** Add a rounded rect to the current path: roundRect where the engine has
 *  it (Chromium does), a plain rect where not. */
function addRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function fillRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  addRect(g, x, y, w, h, r);
  g.fill();
}

export interface DrawArgs {
  g: CanvasRenderingContext2D;
  /** Box size in CSS pixels. */
  w: number;
  h: number;
  mode: SpectrumMode;
  /** One level (0..1) per band; length is bandCount(pattern, mode). */
  levels: Float32Array;
  palette: SpectrumPalette;
  /** The ramp colour of each band (rampColor at i / (n - 1)), computed once
   *  by the caller rather than per frame. */
  colors: readonly string[];
  /** Whether the track is sounding: the bars keep a 2px stub while it is,
   *  and vanish entirely once the display has drained. */
  active: boolean;
}

/** The per-band colours a drawer wants, for `n` bands. */
export function bandColors(palette: SpectrumPalette, n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    rampColor(palette, n > 1 ? i / (n - 1) : 0),
  );
}

export function drawBars({ g, w, h, mode, levels, colors, active }: DrawArgs) {
  const n = levels.length;
  const gap = mode === "tile" ? 3 : 4;
  const pad = mode === "tile" ? 8 : 12;
  const bw = Math.max(1, (w - pad * 2 - gap * (n - 1)) / n);
  const maxH = mode === "overlay" ? h - 6 : h * (mode === "tile" ? 0.78 : 0.72);
  const baseY = mode === "full" ? h * 0.86 : h - (mode === "tile" ? 8 : 0);
  const stub = active ? 2 : 0;
  for (let i = 0; i < n; i++) {
    const bh = Math.max(stub, levels[i] * maxH);
    if (bh <= 0) continue;
    g.fillStyle = colors[i]!;
    g.globalAlpha = mode === "overlay" ? 0.9 : 1;
    const x = pad + i * (bw + gap);
    fillRect(g, x, baseY - bh, bw, bh, bw / 2);
    if (mode === "full") {
      // A soft reflection under the baseline.
      g.globalAlpha = 0.14;
      fillRect(g, x, baseY + 4, bw, bh * 0.35, bw / 2);
    }
  }
  g.globalAlpha = 1;
}

export function drawRing({ g, w, h, mode, levels, colors }: DrawArgs) {
  const n = levels.length;
  const cx = w / 2;
  const cy = h / 2;
  // Proportions of the design's 315px stage and 120px tile, so the ring
  // scales with the box it is in.
  const unit = Math.min(w, h);
  const inner =
    unit *
    (mode === "tile" ? 32 / 120 : mode === "overlay" ? 96 / 315 : 82 / 315);
  const maxLen =
    unit *
    (mode === "tile" ? 18 / 120 : mode === "overlay" ? 42 / 315 : 52 / 315);
  g.lineWidth = mode === "tile" ? 2.5 : 3.5;
  g.lineCap = "round";
  g.globalAlpha = 0.95;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const len = 3 + levels[i] * maxLen;
    g.strokeStyle = colors[i]!;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(
      cx + Math.cos(a) * (inner + len),
      cy + Math.sin(a) * (inner + len),
    );
    g.stroke();
  }
  g.globalAlpha = 1;
}

export function drawLed({ g, w, h, mode, levels, palette }: DrawArgs) {
  const cols = levels.length;
  const rows = mode === "tile" ? 10 : mode === "overlay" ? 7 : 14;
  const gap = mode === "full" ? 6 : 4;
  const padX = mode === "full" ? 40 : 10;
  const padY = mode === "full" ? 36 : 8;
  const cw = Math.max(1, (w - padX * 2 - gap * (cols - 1)) / cols);
  const ch = Math.max(1, (h - padY * 2 - gap * (rows - 1)) / rows);
  const radius = Math.min(cw, ch) * 0.3;
  // Up to 420 cells a frame, but only five colours: one path and one fill
  // per colour rather than per cell.
  const shades = [
    palette.success,
    palette.accent2,
    palette.warn,
    palette.error,
    rgba(palette.fg, 0.07),
  ];
  const UNLIT = 4;
  const shadeOf = (frac: number) =>
    frac < 0.6 ? 0 : frac < 0.8 ? 1 : frac < 0.93 ? 2 : 3;
  for (let s = 0; s < shades.length; s++) {
    g.beginPath();
    let any = false;
    for (let c = 0; c < cols; c++) {
      const lit = Math.round(levels[c] * rows);
      const x = padX + c * (cw + gap);
      for (let r = 0; r < rows; r++) {
        const shade = r < lit ? shadeOf((r + 1) / rows) : UNLIT;
        if (shade !== s) continue;
        any = true;
        addRect(g, x, h - padY - (r + 1) * ch - r * gap, cw, ch, radius);
      }
    }
    if (!any) continue;
    g.fillStyle = shades[s]!;
    g.fill();
  }
}

export const DRAWERS: Record<SpectrumPattern, (args: DrawArgs) => void> = {
  bars: drawBars,
  ring: drawRing,
  led: drawLed,
};
