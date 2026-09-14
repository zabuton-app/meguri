// The looks the spectrum display can take, each drawn from the same per-band
// levels (0..1) on a 2D canvas in CSS pixels:
//
// - bars: rounded vertical bars, coloured by frequency along the theme's
//   accent ramp (primary → info → success → accent2 → warn → secondary)
// - ring: radial ticks around a circle in the middle of the box, the same
//   ramp running around the angle
// - led: a dot matrix whose lit rows step through success → accent2 → warn
//   → error like a level meter
// - mirror: bars mirrored about a centre line, the low bands in the middle
// - wave: an oscilloscope trace in the primary colour with an afterglow
// - area: two layered, gradient-filled curves, one behind the other
// - particles: sparks thrown up from each band and falling back
// - strings: one string per band, plucked into vibration by its level
// - ridge: the last moments of the spectrum receding like a mountain range
// - ripple: rings spreading on the beat and fading like drops on water
// - orbs: glowing spheres, one per band, drifting and pulsing
// - barcode: full-height hairlines whose brightness is their energy
//
// A pattern is drawn in one of three modes, which decide its geometry: over
// the cover art on the stage (`overlay`, a band along the bottom edge or the
// whole stage for the ring), instead of missing cover art (`full`, the whole
// stage) or inside the side peek's 120px tile (`tile`).
//
// Everything a pattern is — its choices and default, how many bands it
// wants, how the host lays the artwork out around it, and the drawing — lives
// here, keyed by the pattern so that adding one fails typecheck until every
// table has a row. The drawers stay free of the DOM (a context and numbers
// in) so they can be tested without a component; the ones that carry motion
// of their own between frames (particles, ripples, a history) are built by a
// factory so each display gets its own state, and report whether
// they still have something moving once the levels have drained so the host
// keeps the frames coming until they are done.

export const SPECTRUM_PATTERN_OPTIONS = [
  "bars",
  "ring",
  "led",
  "mirror",
  "wave",
  "area",
  "particles",
  "strings",
  "ridge",
  "ripple",
  "orbs",
  "barcode",
] as const;
export type SpectrumPattern = (typeof SPECTRUM_PATTERN_OPTIONS)[number];
export const DEFAULT_SPECTRUM_PATTERN: SpectrumPattern = "bars";

export function isSpectrumPattern(v: unknown): v is SpectrumPattern {
  return SPECTRUM_PATTERN_OPTIONS.includes(v as SpectrumPattern);
}

/** The pattern after (`1`) or before (`-1`) `current` in the settings order,
 *  wrapping around at either end. */
export function cycleSpectrumPattern(
  current: SpectrumPattern,
  dir: 1 | -1,
): SpectrumPattern {
  const n = SPECTRUM_PATTERN_OPTIONS.length;
  const i = SPECTRUM_PATTERN_OPTIONS.indexOf(current);
  return SPECTRUM_PATTERN_OPTIONS[(i + dir + n) % n];
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
  /** For the unlit LED cells (at a low alpha), the scope grid, the string
   *  pins, the front ridge line and the orbs' cores. */
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
    case "mirror":
      // Half the columns plus the centre one: the rest are their mirror.
      return mode === "tile" ? 7 : 21;
    case "wave":
    case "ripple":
      // These read a low, a mid and a high band out of a coarse spectrum.
      return 24;
    case "area":
      return 40;
    case "particles":
      return mode === "tile" ? 8 : 24;
    case "strings":
      return mode === "tile" ? 5 : 11;
    case "ridge":
      return mode === "tile" ? 24 : 56;
    case "orbs":
      return mode === "tile" ? 8 : 18;
    case "barcode":
      return mode === "tile" ? 24 : 64;
  }
}

/** How a host lays its artwork out around a pattern. */
export interface PatternLayout {
  /** Tailwind classes for the box the display fills when laid over the
   *  cover art: a band along the bottom, a band above the transport, or the
   *  whole stage. The art itself is shown the same way under every pattern. */
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
  // A band across the middle of the art, clear of the transport.
  mirror: {
    overlayBox: "absolute inset-x-0 bottom-[14%] h-[41%]",
    glyph: "corner",
  },
  wave: {
    overlayBox: "absolute inset-x-0 bottom-[12%] h-[48%]",
    glyph: "corner",
  },
  area: {
    overlayBox: "absolute bottom-0 left-0 h-[38%] w-full",
    glyph: "corner",
  },
  // The rest are sparse enough to lie over the whole picture.
  particles: { overlayBox: "absolute inset-0", glyph: "corner" },
  strings: { overlayBox: "absolute inset-0", glyph: "corner" },
  ridge: { overlayBox: "absolute inset-0", glyph: "corner" },
  ripple: { overlayBox: "absolute inset-0", glyph: "corner" },
  orbs: { overlayBox: "absolute inset-0", glyph: "corner" },
  barcode: { overlayBox: "absolute inset-0", glyph: "corner" },
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

/** `color` (a hex string, or an `rgb(...)` string as the ramp produces)
 *  at `alpha`. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
  if (parts.length < 3) return rgba(color, alpha);
  return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
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

/** The level at `f` (0..1) across the bands. */
function levelAt(levels: Float32Array, f: number): number {
  const n = levels.length;
  return levels[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))] ?? 0;
}

/** How much smaller a pattern's own motion (throws, radii, drift) is in
 *  the side peek's tile, which is about a quarter of the stage's height. */
function modeScale(mode: SpectrumMode): number {
  return mode === "tile" ? 0.4 : 1;
}

function peak(levels: Float32Array): number {
  let m = 0;
  for (let i = 0; i < levels.length; i++) if (levels[i] > m) m = levels[i];
  return m;
}

/** A path through the band tops, smoothed with quadratic midpoints, from
 *  `x0` to `x1` at `baseY` minus the level times `amp`. Leaves the path open
 *  at the last top so the caller can close it however it likes. */
function tracePeaks(
  g: CanvasRenderingContext2D,
  levels: ArrayLike<number>,
  x0: number,
  x1: number,
  baseY: number,
  amp: number,
): void {
  const n = levels.length;
  g.moveTo(x0, baseY);
  let prevX = x0;
  let prevY = baseY - levels[0] * amp;
  g.lineTo(prevX, prevY);
  for (let i = 1; i < n; i++) {
    const x = x0 + (i / (n - 1)) * (x1 - x0);
    const y = baseY - levels[i] * amp;
    g.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
    prevX = x;
    prevY = y;
  }
  g.lineTo(x1, prevY);
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
  /** Seconds since the display was built, for the patterns that move on
   *  their own (a phase, a drift). */
  t: number;
  /** Seconds since the previous frame, clamped by the caller. */
  dt: number;
}

/** Draws one frame. Returns true while the drawer still has motion of its
 *  own to show (falling particles, a receding history) after the levels have
 *  drained, so the host keeps asking for frames; a stateless drawer always
 *  returns false. */
export type Drawer = (args: DrawArgs) => boolean;

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
  return false;
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
  return false;
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
  return false;
}

/** Bars mirrored about the middle line, the lowest band in the centre
 *  column and the highest at both edges. */
export function drawMirror({
  g,
  w,
  h,
  mode,
  levels,
  colors,
  active,
}: DrawArgs) {
  const half = levels.length - 1;
  const n = half * 2 + 1; // odd, so one column sits in the centre
  const gap = mode === "tile" ? 3 : 4;
  const pad = mode === "tile" ? 8 : 12;
  const bw = Math.max(1, (w - pad * 2 - gap * (n - 1)) / n);
  const cy = h / 2;
  const maxH = h / 2 - (mode === "full" ? 24 : 6);
  const stub = active ? 1.5 : 0;
  g.globalAlpha = mode === "overlay" ? 0.92 : 1;
  for (let i = 0; i < n; i++) {
    const band = Math.abs(i - half);
    const bh = Math.max(stub, levels[band] * maxH);
    if (bh <= 0) continue;
    g.fillStyle = colors[band]!;
    fillRect(g, pad + i * (bw + gap), cy - bh, bw, bh * 2, bw / 2);
  }
  g.globalAlpha = 1;
  return false;
}

/** An oscilloscope trace: three sines (a low, a mid and a high band) summed
 *  and drifting, drawn twice for an afterglow. Full mode adds a scope grid. */
export function drawWave({ g, w, h, mode, levels, palette, t }: DrawArgs) {
  const lo = levelAt(levels, 0.04);
  const mid = levelAt(levels, 0.35);
  const hi = levelAt(levels, 0.75);
  const cy = h / 2;
  const amp = (h / 2) * (mode === "full" ? 0.62 : 0.75);
  if (mode === "full") {
    g.strokeStyle = rgba(palette.fg, 0.07);
    g.lineWidth = 1;
    g.globalAlpha = 1;
    g.beginPath();
    for (let gx = 0; gx <= 8; gx++) {
      g.moveTo((w * gx) / 8, 0);
      g.lineTo((w * gx) / 8, h);
    }
    for (let gy = 0; gy <= 4; gy++) {
      g.moveTo(0, (h * gy) / 4);
      g.lineTo(w, (h * gy) / 4);
    }
    g.stroke();
  }
  const pts = 140;
  const ph = t * 5;
  const trace = (width: number, alpha: number, phOff: number) => {
    g.strokeStyle = palette.primary;
    g.lineWidth = width;
    g.globalAlpha = alpha;
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const f = i / pts;
      const x = f * Math.PI * 2;
      const p = ph + phOff;
      const y =
        (Math.sin(x * 2 + p) * lo * 0.9 +
          Math.sin(x * 5.3 + p * 1.7) * mid * 0.5 +
          Math.sin(x * 13.7 + p * 2.3) * hi * 0.25) *
        amp *
        Math.pow(Math.sin(f * Math.PI), 0.4); // pinned at both ends
      if (i === 0) g.moveTo(f * w, cy + y);
      else g.lineTo(f * w, cy + y);
    }
    g.stroke();
  };
  trace(mode === "tile" ? 5 : 8, 0.25, -0.35);
  trace(mode === "tile" ? 1.5 : 2.25, 1, 0);
  g.globalAlpha = 1;
  return false;
}

/** Two smoothed, gradient-filled curves: a secondary-accent one behind
 *  (smaller, and shifted along the bands so it does not just echo the
 *  front) and the primary one in front. A factory only so the shifted copy
 *  and the two gradients (which depend on the box height and the theme, not
 *  the frame) are made once, not sixty times a second. */
export function createArea(): Drawer {
  let shifted = new Float32Array(0);
  const gradients = new Map<string, CanvasGradient>();
  return ({ g, w, h, mode, levels, palette }) => {
    const n = levels.length;
    const baseY = h;
    const maxH = h * (mode === "full" ? 0.8 : 0.92);
    const gradientFor = (color: string) => {
      const key = `${color}|${h}|${mode}`;
      let grad = gradients.get(key);
      if (!grad) {
        // A resize or a theme change makes a new key; drop the old ones.
        if (gradients.size >= 4) gradients.clear();
        grad = g.createLinearGradient(0, baseY - maxH, 0, baseY);
        grad.addColorStop(0, color);
        grad.addColorStop(1, withAlpha(color, 0));
        gradients.set(key, grad);
      }
      return grad;
    };
    const layer = (color: string, values: ArrayLike<number>, alpha: number) => {
      g.beginPath();
      tracePeaks(g, values, 0, w, baseY, maxH);
      g.lineTo(w, baseY);
      g.closePath();
      g.fillStyle = gradientFor(color);
      g.globalAlpha = alpha;
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.globalAlpha = Math.min(1, alpha + 0.25);
      g.stroke();
    };
    if (shifted.length !== n) shifted = new Float32Array(n);
    for (let i = 0; i < n; i++) shifted[i] = levels[(i + 7) % n] * 0.72;
    layer(palette.secondaryAccent, shifted, 0.5);
    layer(palette.primary, levels, 0.75);
    g.globalAlpha = 1;
    return false;
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  band: number;
}

// Enough for a loud passage on the stage; older sparks go first. Fewer in
// the tile, where the same count would read as noise.
const MAX_PARTICLES = 240;
const MAX_TILE_PARTICLES = 60;
// Sparks a loud band throws per second (the design's 0.7 a frame at 60 Hz).
const SPAWN_RATE = 42;
// Sparks are drawn in batches: one path and fill per band colour and alpha
// step rather than per spark.
const ALPHA_STEPS = 4;

/** Drop the items `dead` says are done, in place (no per-frame garbage). */
function compact<T>(items: T[], dead: (item: T) => boolean): void {
  let w = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!dead(item)) items[w++] = item;
  }
  items.length = w;
}

/** Sparks thrown up from each band while it is loud, over a row of embers
 *  along the bottom. The sparks outlive the sound that threw them. */
export function createParticles(): Drawer {
  const particles: Particle[] = [];
  let buckets: number[][] = [];
  return ({ g, w, h, mode, levels, colors, active, dt }) => {
    const n = levels.length;
    // Throw less far, and fewer, in the tile.
    const k = modeScale(mode);
    const cap = mode === "tile" ? MAX_TILE_PARTICLES : MAX_PARTICLES;
    const slot = w / n;
    if (active) {
      for (let i = 0; i < n; i++) {
        const lv = levels[i];
        if (lv > 0.3 && Math.random() < lv * SPAWN_RATE * k * dt) {
          particles.push({
            x: (i + 0.5) * slot + (Math.random() - 0.5) * 14 * k,
            y: h - 8 * k,
            vx: (Math.random() - 0.5) * 24 * k,
            vy: -(40 + lv * 200 + Math.random() * 60) * k,
            r: (1.5 + lv * 3 + Math.random() * 1.5) * k,
            life: 1,
            band: i,
          });
        }
      }
    }
    if (particles.length > cap) particles.splice(0, particles.length - cap);
    // Embers along the baseline: a glowing stub while the track sounds,
    // nothing once it has drained (the sparks still up finish falling).
    g.globalAlpha = 0.5;
    const stub = active ? 3 : 0;
    for (let i = 0; i < n; i++) {
      const bh = (stub + levels[i] * 10) * k;
      if (bh <= 0) continue;
      g.fillStyle = colors[i];
      g.fillRect((i + 0.15) * slot, h - bh, slot * 0.7, bh);
    }
    // Move every spark, then sort the live ones into buckets.
    if (buckets.length !== n * ALPHA_STEPS)
      buckets = Array.from({ length: n * ALPHA_STEPS }, () => []);
    else for (const bucket of buckets) bucket.length = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * k * dt; // a little gravity
      p.life -= dt * 0.9;
      if (p.life <= 0) continue;
      const step = Math.min(ALPHA_STEPS - 1, Math.floor(p.life * ALPHA_STEPS));
      buckets[p.band * ALPHA_STEPS + step].push(i);
    }
    for (let b = 0; b < buckets.length; b++) {
      const members = buckets[b];
      if (members.length === 0) continue;
      const step = b % ALPHA_STEPS;
      g.fillStyle = colors[(b - step) / ALPHA_STEPS];
      g.globalAlpha = ((step + 1) / ALPHA_STEPS) * 0.9;
      g.beginPath();
      for (const i of members) {
        const p = particles[i];
        const r = p.r * (0.5 + p.life * 0.5);
        g.moveTo(p.x + r, p.y);
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    compact(particles, (p) => p.life <= 0 || p.y <= -10);
    return particles.length > 0;
  };
}

/** One string per band across the box, pinned at both ends, vibrating with
 *  an amplitude and a brightness set by its level. */
export function drawStrings({
  g,
  w,
  h,
  mode,
  levels,
  colors,
  palette,
  t,
}: DrawArgs) {
  const S = levels.length;
  const pad = mode === "tile" ? 12 : 26;
  const maxAmp = mode === "tile" ? 6 : 16;
  const pts = mode === "tile" ? 40 : 90;
  g.lineCap = "round";
  for (let s = 0; s < S; s++) {
    const lv = levels[s];
    const cy = pad + (S > 1 ? s / (S - 1) : 0.5) * (h - pad * 2);
    const amp = lv * maxAmp;
    const freq = 2 + s * 0.9;
    g.strokeStyle = colors[s]!;
    g.lineWidth = 1.5 + lv * 2;
    g.globalAlpha = 0.35 + lv * 0.65;
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const f = i / pts;
      const env = Math.sin(f * Math.PI); // pinned at both ends
      const y = cy + Math.sin(f * Math.PI * freq + t * (6 + s)) * amp * env;
      if (i === 0) g.moveTo(f * w, y);
      else g.lineTo(f * w, y);
    }
    g.stroke();
    // The pins.
    g.globalAlpha = 0.5;
    g.fillStyle = rgba(palette.fg, 0.35);
    g.beginPath();
    g.arc(3, cy, 2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(w - 3, cy, 2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return false;
}

// A new row of the ridge every so often, and how many rows are kept.
const RIDGE_INTERVAL = 0.07;

/** The last moments of the spectrum as a range of ridges receding into the
 *  distance: the newest row in front in the bright foreground colour, older
 *  rows smaller, higher and fainter behind it, each hiding the lines behind
 *  it (the body is cut out of the canvas rather than painted, so the art or
 *  the background shows through). */
export function createRidge(): Drawer {
  let hist: Float32Array[] = [];
  let acc = 0;
  return ({ g, w, h, mode, levels, palette, active, dt }) => {
    // Ten rows on the stage: each is a compositing erase over a wide body,
    // so the count is the pattern's cost.
    const rows = mode === "tile" ? 6 : 10;
    acc += dt;
    if (acc >= RIDGE_INTERVAL || hist.length === 0) {
      // Carry the remainder so the cadence holds at any frame rate.
      acc = Math.min(RIDGE_INTERVAL, Math.max(0, acc - RIDGE_INTERVAL));
      hist.unshift(Float32Array.from(levels));
      if (hist.length > rows) hist.length = rows;
    }
    const alive = hist.some((row) => peak(row) > 0);
    if (!active && !alive) {
      // Drained and quiet: nothing to recede any more.
      hist = [];
      return false;
    }
    const padX = mode === "tile" ? 8 : 30;
    const reach = mode === "tile" ? 12 : 46;
    for (let r = hist.length - 1; r >= 0; r--) {
      const depth = r / (rows - 1); // 0 in front .. 1 at the back
      const baseY = h * 0.88 - depth * h * 0.5;
      const amp = h * 0.34 * (1 - depth * 0.55);
      const inset = padX + depth * reach;
      g.beginPath();
      tracePeaks(g, hist[r], inset, w - inset, baseY, amp);
      g.lineTo(w - inset, baseY);
      g.closePath();
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "#000";
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.strokeStyle =
        r === 0 ? palette.fg : rgba(palette.primary, 1 - depth * 0.75);
      g.lineWidth = r === 0 ? 2 : 1.25;
      g.stroke();
    }
    return alive;
  };
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
  color: string;
}

const MAX_RIPPLES = 20;
// The shortest gap between two beat rings.
// A quarter of the design's rates throughout: at full rate the rings
// crowded each other out and none could be followed.
const KICK_GAP = 0.88;

/** Rings spreading out and fading like drops on water: a big one in the
 *  middle on each kick, small ones scattered by the mids, and a few ambient
 *  ones so the panel is never quite still while the track plays. */
export function createRipple(): Drawer {
  const ripples: Ripple[] = [];
  let lastKick = -Infinity;
  return ({ g, w, h, mode, levels, palette, active, t, dt }) => {
    const lo = levelAt(levels, 0.03);
    const mid = levelAt(levels, 0.45);
    const k = modeScale(mode);
    const spawn = (x: number, y: number, r: number, life: number) => {
      ripples.push({
        x,
        y,
        r: r * k,
        life,
        color: rampColor(palette, Math.random()),
      });
    };
    if (active) {
      if (lo > 0.55 && t - lastKick > KICK_GAP) {
        lastKick = t;
        spawn(
          w * (0.3 + Math.random() * 0.4),
          h * (0.3 + Math.random() * 0.4),
          6,
          1.4,
        );
      }
      if (mid > 0.4 && Math.random() < dt * 2.25)
        spawn(Math.random() * w, Math.random() * h, 3, 0.9);
      if (lo + mid > 0 && Math.random() < dt * 0.625)
        spawn(
          Math.random() * w,
          Math.random() * h,
          2,
          0.7 + Math.random() * 0.4,
        );
    }
    for (const rp of ripples) {
      rp.r += (60 + lo * 90) * k * dt;
      rp.life -= dt * 0.55;
      // A kick ring starts with more than a second of life; alpha is 0..1.
      const a = Math.min(1, Math.max(0, rp.life));
      if (a <= 0) continue;
      g.strokeStyle = rp.color;
      g.lineWidth = (1.5 + a * 2.5) * (mode === "tile" ? 0.7 : 1);
      g.globalAlpha = a * 0.85;
      g.beginPath();
      g.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = a * 0.3;
      g.beginPath();
      g.arc(rp.x, rp.y, rp.r * 0.72, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    compact(ripples, (rp) => rp.life <= 0);
    if (ripples.length > MAX_RIPPLES)
      ripples.splice(0, ripples.length - MAX_RIPPLES);
    return ripples.length > 0;
  };
}

interface Orb {
  /** Position as a fraction of the box, so a resize keeps them spread. */
  fx: number;
  fy: number;
  /** Drift in CSS px/s. */
  vx: number;
  vy: number;
  ph: number;
}

/** One glowing sphere per band, drifting about the box and swelling and
 *  brightening with its band's level, with a bright core. */
export function createOrbs(): Drawer {
  // One per band, seeded on the first frame (there is no box size before).
  let orbs: Orb[] | null = null;
  // The glow is one unit-radius gradient per band colour, made once per
  // palette (the host hands the same `colors` array every frame) and drawn
  // under a translate/scale, rather than a fresh gradient per orb per frame.
  let glowColors: readonly string[] | null = null;
  let glows: CanvasGradient[] = [];
  return ({ g, w, h, mode, levels, colors, palette, t, dt }) => {
    const n = levels.length;
    orbs ??= Array.from({ length: n }, () => ({
      fx: Math.random(),
      fy: Math.random(),
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 10,
      ph: Math.random() * Math.PI * 2,
    }));
    if (glowColors !== colors) {
      glowColors = colors;
      glows = colors.map((col) => {
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, col);
        glow.addColorStop(0.35, col);
        glow.addColorStop(1, withAlpha(col, 0));
        return glow;
      });
    }
    const k = mode === "tile" ? 0.5 : 1;
    // Wrap a little beyond the edges so a glow leaves before it reappears.
    const mx = (20 * k) / w;
    const my = (20 * k) / h;
    for (let i = 0; i < n; i++) {
      const o = orbs[i];
      o.fx += ((o.vx + Math.sin(t * 0.6 + o.ph) * 6) * k * dt) / w;
      o.fy += ((o.vy + Math.cos(t * 0.5 + o.ph * 1.3) * 5) * k * dt) / h;
      if (o.fx < -mx) o.fx = 1 + mx;
      else if (o.fx > 1 + mx) o.fx = -mx;
      if (o.fy < -my) o.fy = 1 + my;
      else if (o.fy > 1 + my) o.fy = -my;
      const x = o.fx * w;
      const y = o.fy * h;
      const lv = levels[i];
      const r = (3 + lv * 15) * k;
      g.save();
      g.translate(x, y);
      g.scale(r * 2.6, r * 2.6);
      g.globalAlpha = 0.25 + lv * 0.75;
      g.fillStyle = glows[i];
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.globalAlpha = Math.min(1, 0.5 + lv);
      g.fillStyle = palette.fg;
      g.beginPath();
      g.arc(x, y, Math.max(1, r * 0.22), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    return false;
  };
}

/** Hairlines across nearly the full height, one per band, whose weight and
 *  brightness are the band's energy; quiet bands stay as a faint trace. */
export function drawBarcode({ g, w, h, mode, levels, colors }: DrawArgs) {
  const n = levels.length;
  const padY = mode === "tile" ? 10 : 26;
  const shrink = mode === "tile" ? 5 : 14;
  for (let i = 0; i < n; i++) {
    const lv = levels[i];
    const x = ((i + 0.5) / n) * w;
    g.strokeStyle = colors[i]!;
    g.globalAlpha = 0.06 + Math.pow(lv, 1.4) * 0.94;
    g.lineWidth = 1 + lv * 4;
    g.beginPath();
    g.moveTo(x, padY + (1 - lv) * shrink);
    g.lineTo(x, h - padY - (1 - lv) * shrink);
    g.stroke();
  }
  g.globalAlpha = 1;
  return false;
}

/** A fresh drawer for a display: the stateless patterns share one function,
 *  the ones with motion of their own get state of their own. */
export function createDrawer(pattern: SpectrumPattern): Drawer {
  switch (pattern) {
    case "bars":
      return drawBars;
    case "ring":
      return drawRing;
    case "led":
      return drawLed;
    case "mirror":
      return drawMirror;
    case "wave":
      return drawWave;
    case "area":
      return createArea();
    case "particles":
      return createParticles();
    case "strings":
      return drawStrings;
    case "ridge":
      return createRidge();
    case "ripple":
      return createRipple();
    case "orbs":
      return createOrbs();
    case "barcode":
      return drawBarcode;
  }
}
