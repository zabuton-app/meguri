// base16 → semantic token derivation.
//
// A base16 palette is a set of 16 colors, not a contrast-checked design system: several
// upstream schemes have ramps that are non-monotonic (ayu-light's base02 is *lighter* than
// base01) or repurpose slots for accents (catppuccin-latte's base06 is salmon). Mapping the
// slots straight onto UI roles therefore produces themes where hairlines, secondary text or
// even body text disappear.
//
// So the palettes stay untouched (they follow upstream) and this layer enforces per-token
// contrast floors on top of them. A color that already clears its floor is passed through
// unchanged, which keeps schemes that were fine — gruvbox-dark and friends — looking the same.
import type { Base16Scheme } from "./base16";
import {
  contrastRatio,
  ensureContrast,
  farSide,
  opposite,
  pickFirst,
  type ContrastReq,
  type Hex,
} from "./color";

/** Semantic tokens taken verbatim from a base16 slot. */
const SEMANTIC_MAP = {
  bg: 0x0,
  surface: 0x1,
  overlay: 0x2,
  border: 0x2,
  muted: 0x3,
  "secondary-fg": 0x4,
  fg: 0x5,
  "bright-fg": 0x6,
  highlight: 0x7,
  error: 0x8,
  warn: 0x9,
  accent2: 0xa,
  success: 0xb,
  info: 0xc,
  primary: 0xd,
  "secondary-accent": 0xe,
  special: 0xf,
} as const;

export type SemanticToken = keyof typeof SEMANTIC_MAP;

/** Tokens with no base16 slot of their own. */
export type ExtraToken = "border-strong" | "hover";

export type Token = SemanticToken | ExtraToken;

export type DerivedTokens = Record<Token, Hex>;

/**
 * Contrast floors, all relative to the scheme's own background(s).
 *
 * `border` stays deliberately low: hairlines are decorative separators, which WCAG 1.4.11
 * exempts, and 3:1 draws a heavier line than the themes' own designs use. `border-strong`
 * covers the parts that 1.4.11 *does* apply to (form control outlines, the switch's off
 * track). Tokens absent from this list are either backgrounds or unused by components.
 */
export const FLOORS = {
  /** vs bg and surface. */
  border: 1.5,
  /** vs bg and surface. Form controls and other meaningful UI boundaries. */
  borderStrong: 3,
  /** vs bg / vs surface. Raised fills: thumbnail placeholders, chips, row hover. */
  overlay: [1.25, 1.15],
  /** vs surface. Menu/list highlight has to separate from the popover it sits in. */
  hover: 1.35,
  /** vs bg / vs surface. Secondary text. */
  muted: [4.5, 4],
  /** vs bg and surface (AA), and at least this much more contrast than muted. */
  fg: 4.5,
  fgOverMuted: 1.5,
  /** vs bg (AA), and never below fg. */
  brightFg: 4.5,
  /** Text on the raised fills: fg on overlay, bright-fg on hover. */
  textOnRaised: 4.5,
  /** vs bg. Used as text (`text-primary`, `text-error`) and as chip fills. */
  accentText: 4.5,
  /** vs bg. Icon-only accents, where AA for text does not apply. */
  accentIcon: 3,
} as const;

/**
 * Resolve one scheme into the semantic tokens the UI actually consumes.
 *
 * Order matters: later tokens are derived from already-corrected earlier ones. Text first
 * (muted → fg → bright-fg), then the raised fills that text sits on (overlay → hover), so the
 * fills can be bounded against the final text colors.
 */
function computeTokens(scheme: Base16Scheme): DerivedTokens {
  const p = scheme.palette;
  const raw = (token: SemanticToken): Hex => p[SEMANTIC_MAP[token]];

  const bg = raw("bg");
  const surface = raw("surface");
  const req = (against: Hex, ratio: number): ContrastReq => ({
    against,
    ratio,
  });

  const border = ensureContrast(raw("border"), [
    req(bg, FLOORS.border),
    req(surface, FLOORS.border),
  ]);
  // Switch tracks and input outlines sit on panels as often as on the page itself.
  const borderStrong = ensureContrast(raw("border"), [
    req(bg, FLOORS.borderStrong),
    req(surface, FLOORS.borderStrong),
  ]);

  const muted = ensureContrast(raw("muted"), [
    req(bg, FLOORS.muted[0]),
    req(surface, FLOORS.muted[1]),
  ]);
  // Body text has to stay clearly ahead of secondary text. Without this, schemes whose
  // base05 is barely readable (material-light) end up with fg == muted after both are
  // lifted to AA, and the visual hierarchy collapses.
  const fg = ensureContrast(raw("fg"), [
    req(bg, Math.max(FLOORS.fg, contrastRatio(muted, bg) * FLOORS.fgOverMuted)),
    req(surface, FLOORS.fg),
  ]);

  // Emphasis text: prefer a palette slot that is already strong enough over darkening
  // base06, which would turn the off-whites of tomorrow-night/ayu-dark/github-dark into
  // flat #ffffff and cost those themes their character.
  const brightFgFloor = Math.max(FLOORS.brightFg, contrastRatio(fg, bg));
  const brightFg =
    pickFirst([raw("bright-fg"), raw("highlight")], [req(bg, brightFgFloor)]) ??
    ensureContrast(fg, [req(bg, brightFgFloor * 1.25)]);

  // Raised fills carry text, so they are bounded from both sides: far enough from the page
  // and panel to register as raised, but never so far that what sits on them stops being
  // readable. Solarized needs the cap — its base02 is a big step away from bg while base05 is
  // a small one, so the raw slot leaves body text at 2.5:1 on top of it.
  //
  // Both bounds fit only while `cr(fg, bg) >= overlay[0] * textOnRaised` (5.625) and
  // `cr(bright-fg, surface) >= hover * textOnRaised` (6.075) — contrast is multiplicative
  // along the lightness axis. Every current scheme clears both with room to spare; a palette
  // that does not will fail the "separates ... fills" tests in derive.test.ts, and the fix
  // there is to raise FLOORS.fg rather than to lower the floors here.
  //
  // Each step's direction is read off the fill's own position relative to bg rather than from
  // a light/dark classification of a single color, so "raise it further" and "pull it back"
  // stay meaningful even when bg and surface land on opposite sides of that classification.
  const raisedOverlay = ensureContrast(raw("overlay"), [
    req(bg, FLOORS.overlay[0]),
    req(surface, FLOORS.overlay[1]),
  ]);
  const overlay = ensureContrast(
    raisedOverlay,
    [req(fg, FLOORS.textOnRaised)],
    opposite(farSide(bg, raisedOverlay)),
  );
  // The menu highlight separates from the popover background, which is surface — but it has to
  // do so by moving further from the page, not by sliding back toward it.
  const raisedHover = ensureContrast(
    overlay,
    [req(surface, FLOORS.hover)],
    farSide(bg, overlay),
  );
  const hover = ensureContrast(
    raisedHover,
    [req(brightFg, FLOORS.textOnRaised)],
    opposite(farSide(bg, raisedHover)),
  );

  const accentText = (token: SemanticToken): Hex =>
    ensureContrast(raw(token), [req(bg, FLOORS.accentText)]);

  return {
    ...(Object.fromEntries(
      Object.keys(SEMANTIC_MAP).map((t) => [t, raw(t as SemanticToken)]),
    ) as Record<SemanticToken, Hex>),
    border,
    "border-strong": borderStrong,
    overlay,
    hover,
    muted,
    fg,
    "bright-fg": brightFg,
    // primary/error/info double as text and as chip fills; the ratio being symmetric means
    // a 4.5 floor here also makes `text-bg` on top of them (Button, tag chips) pass AA.
    primary: accentText("primary"),
    error: accentText("error"),
    info: accentText("info"),
    // Rating stars are icons, so the non-text threshold applies. Forcing 4.5 would drag the
    // yellows into dark brown.
    accent2: ensureContrast(raw("accent2"), [req(bg, FLOORS.accentIcon)]),
  };
}

const cache = new WeakMap<Base16Scheme, DerivedTokens>();

/**
 * Memoized {@link computeTokens}. Palettes are immutable, and the theme picker resolves every
 * scheme on each render, so the results are cached per scheme object.
 */
export function deriveTokens(scheme: Base16Scheme): DerivedTokens {
  let tokens = cache.get(scheme);
  if (!tokens) {
    tokens = Object.freeze(computeTokens(scheme));
    cache.set(scheme, tokens);
  }
  return tokens;
}

/**
 * Format a scheme's derived tokens as the "--c-<token>: <hex>;" declarations that go into its
 * `html[data-theme="<id>"]` block. `--c-*` are the runtime-swappable values that Tailwind's
 * `--color-*` reference via @theme inline.
 */
export function schemeToCssVars(scheme: Base16Scheme): string {
  return Object.entries(deriveTokens(scheme))
    .map(([token, hex]) => `  --c-${token}: ${hex};`)
    .join("\n");
}
