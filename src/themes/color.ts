// Color math for the theme derivation layer (see derive.ts).
//
// Contrast follows WCAG 2.x. Lightness adjustments happen in OKLab with a/b held fixed,
// so hue and chroma survive: blending toward plain white in sRGB reliably washes accent
// colors out into pastel, which would cost the themes their character.

/** An "#rrggbb" color. Every base16 palette entry is in this form. */
export type Hex = string;

export type Direction = "lighter" | "darker";

export interface ContrastReq {
  /** Background the color has to stay readable against. */
  against: Hex;
  /** Minimum contrast ratio (1..21). */
  ratio: number;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Relative luminance above which WCAG treats a background as "light". */
const LIGHT_BG_LUMINANCE = 0.179;

export function parseHex(hex: Hex): [number, number, number] {
  if (!HEX_RE.test(hex)) throw new Error(`Not a #rrggbb color: ${hex}`);
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): Hex {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

const toLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

const fromLinear = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = parseHex(hex).map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export function toOklab(hex: Hex): Oklab {
  const [r, g, b] = parseHex(hex).map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Back to sRGB. Out-of-gamut values are clamped by the 8-bit rounding in toHex(). */
export function fromOklab({ L, a, b }: Oklab): Hex {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex(
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  );
}

/** The direction that moves away from a background of this luminance. */
export function awayFrom(bg: Hex): Direction {
  return relativeLuminance(bg) > LIGHT_BG_LUMINANCE ? "darker" : "lighter";
}

/**
 * The direction that takes `color` even further from `bg`.
 *
 * Unlike {@link awayFrom} this reads the pair's actual relationship instead of classifying a
 * single color as light or dark, so it stays right for a raised fill whose background sits
 * near the light/dark boundary, or on the "wrong" side of it.
 */
export function farSide(bg: Hex, color: Hex): Direction {
  return relativeLuminance(color) >= relativeLuminance(bg)
    ? "lighter"
    : "darker";
}

export const opposite = (direction: Direction): Direction =>
  direction === "lighter" ? "darker" : "lighter";

const satisfies = (color: Hex, reqs: ContrastReq[]): boolean =>
  reqs.every((r) => contrastRatio(color, r.against) >= r.ratio);

/**
 * Return `color` if it already meets every requirement, otherwise the nearest color that does,
 * searching along the OKLab lightness axis **in one direction only**.
 *
 * That direction is `direction` when given, and otherwise the one that moves away from the
 * first requirement's background. It is not "nearest in both directions": with several
 * requirements, or a mid-tone color, the two directions are not equivalent, and callers that
 * care (raised fills, which must not slide back toward the page) pass it explicitly.
 *
 * The search runs a fixed 24 bisection steps (finer than 8-bit quantization) and only ever
 * keeps candidates that were measured *after* rounding to sRGB, so the returned color really
 * meets the target. When the extreme of the chosen direction (pure black or white) still
 * cannot reach it, that extreme is returned as a best effort — never throws, so adding a
 * pathological palette degrades instead of crashing.
 */
export function ensureContrast(
  color: Hex,
  reqs: ContrastReq[],
  direction?: Direction,
): Hex {
  if (reqs.length === 0 || satisfies(color, reqs)) return color;

  const darken = (direction ?? awayFrom(reqs[0].against)) === "darker";
  const { L: L0, a, b } = toOklab(color);
  const extreme = fromOklab({ L: darken ? 0 : 1, a, b });
  if (!satisfies(extreme, reqs)) return extreme;

  let lo = darken ? 0 : L0;
  let hi = darken ? L0 : 1;
  let best = extreme;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = fromOklab({ L: mid, a, b });
    if (satisfies(candidate, reqs)) {
      best = candidate;
      if (darken) lo = mid;
      else hi = mid;
    } else {
      if (darken) hi = mid;
      else lo = mid;
    }
  }
  return best;
}

/** First candidate meeting every requirement, or `undefined` when none does. */
export function pickFirst(
  candidates: Hex[],
  reqs: ContrastReq[],
): Hex | undefined {
  return candidates.find((c) => satisfies(c, reqs));
}
