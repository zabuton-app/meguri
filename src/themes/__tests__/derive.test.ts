import { describe, expect, it } from "vitest";
import { awayFrom, contrastRatio, relativeLuminance } from "../color";
import { deriveTokens, FLOORS, schemeToCssVars } from "../derive";
import { SCHEMES } from "../schemes";

// Contrast floors are enforced per scheme in derive.ts. These tests are the guard rail for
// adding a theme: a palette may come straight from upstream, but the derived tokens still
// have to clear the floors and keep the visual hierarchy intact.
describe.each(SCHEMES.map((s) => [s.id, s] as const))("%s", (_id, scheme) => {
  const t = deriveTokens(scheme);
  const cr = (color: string, against: string) => contrastRatio(color, against);

  it("uses #rrggbb throughout the palette", () => {
    for (const color of scheme.palette)
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("draws visible hairlines", () => {
    expect(cr(t.border, t.bg)).toBeGreaterThanOrEqual(FLOORS.border);
    expect(cr(t.border, t.surface)).toBeGreaterThanOrEqual(FLOORS.border);
  });

  it("draws form-control outlines at the non-text threshold", () => {
    expect(cr(t["border-strong"], t.bg)).toBeGreaterThanOrEqual(
      FLOORS.borderStrong,
    );
    expect(cr(t["border-strong"], t.surface)).toBeGreaterThanOrEqual(
      FLOORS.borderStrong,
    );
  });

  it("separates overlay fills from the page and panel backgrounds", () => {
    expect(cr(t.overlay, t.bg)).toBeGreaterThanOrEqual(FLOORS.overlay[0]);
    expect(cr(t.overlay, t.surface)).toBeGreaterThanOrEqual(FLOORS.overlay[1]);
  });

  it("separates the menu highlight from the popover it sits in", () => {
    // --color-popover is surface, so that is what the highlight has to stand out from.
    expect(cr(t.hover, t.surface)).toBeGreaterThanOrEqual(FLOORS.hover);
  });

  it("keeps the raised fills on the far side of the background", () => {
    // They are clamped back toward bg to stay readable; that must never overshoot into a
    // fill that is *less* prominent than the page.
    const beyondBg = (color: string) =>
      awayFrom(t.bg) === "lighter"
        ? relativeLuminance(color) > relativeLuminance(t.bg)
        : relativeLuminance(color) < relativeLuminance(t.bg);
    expect(beyondBg(t.overlay)).toBe(true);
    expect(beyondBg(t.hover)).toBe(true);
  });

  it("keeps text readable on the raised fills", () => {
    // bg-overlay carries text-fg (tag chips, table row hover); bg-accent (= hover) carries
    // text-accent-foreground (= bright-fg) in every menu.
    expect(cr(t.fg, t.overlay)).toBeGreaterThanOrEqual(FLOORS.textOnRaised);
    expect(cr(t["bright-fg"], t.hover)).toBeGreaterThanOrEqual(
      FLOORS.textOnRaised,
    );
  });

  it("renders secondary text at AA on the page, close to it on panels", () => {
    // The panel floor is deliberately a little below AA: pushing muted all the way to 4.5 on
    // surface as well would leave it indistinguishable from fg in the tighter schemes.
    expect(cr(t.muted, t.bg)).toBeGreaterThanOrEqual(FLOORS.muted[0]);
    expect(cr(t.muted, t.surface)).toBeGreaterThanOrEqual(FLOORS.muted[1]);
  });

  it("renders body text at AA on both backgrounds", () => {
    expect(cr(t.fg, t.bg)).toBeGreaterThanOrEqual(FLOORS.fg);
    expect(cr(t.fg, t.surface)).toBeGreaterThanOrEqual(FLOORS.fg);
  });

  it("keeps body text clearly ahead of secondary text", () => {
    expect(cr(t.fg, t.bg)).toBeGreaterThanOrEqual(
      cr(t.muted, t.bg) * FLOORS.fgOverMuted - 0.01,
    );
  });

  it("keeps emphasis text at least as strong as body text", () => {
    expect(cr(t["bright-fg"], t.bg)).toBeGreaterThanOrEqual(
      Math.max(FLOORS.brightFg, cr(t.fg, t.bg)) - 0.01,
    );
  });

  it("renders accent text at AA", () => {
    for (const token of ["primary", "error", "info"] as const) {
      expect(cr(t[token], t.bg)).toBeGreaterThanOrEqual(FLOORS.accentText);
    }
  });

  it("puts readable labels on primary and error fills", () => {
    // Contrast is symmetric, so the accent floors also cover `text-bg` on those fills
    // (Button, tag chips) without a dedicated foreground token.
    expect(cr(t.bg, t.primary)).toBeGreaterThanOrEqual(FLOORS.accentText);
    expect(cr(t.bg, t.error)).toBeGreaterThanOrEqual(FLOORS.accentText);
  });

  it("renders accent icons at the non-text threshold", () => {
    expect(cr(t.accent2, t.bg)).toBeGreaterThanOrEqual(FLOORS.accentIcon);
  });

  it("leaves every token as an #rrggbb color", () => {
    for (const hex of Object.values(t)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("FLOORS", () => {
  it("pins the thresholds the other tests are written against", () => {
    // The per-scheme assertions read from FLOORS, so lowering a floor would otherwise turn
    // every one of them green.
    expect(FLOORS).toMatchObject({
      border: 1.5,
      borderStrong: 3,
      overlay: [1.25, 1.15],
      hover: 1.35,
      muted: [4.5, 4],
      fg: 4.5,
      fgOverMuted: 1.5,
      brightFg: 4.5,
      textOnRaised: 4.5,
      accentText: 4.5,
      accentIcon: 3,
    });
  });
});

describe("schemeToCssVars", () => {
  it("emits one declaration per derived token", () => {
    const gruvbox = SCHEMES.find((s) => s.id === "gruvbox-dark")!;
    expect(schemeToCssVars(gruvbox)).toMatchInlineSnapshot(`
      "  --c-bg: #282828;
        --c-surface: #3c3836;
        --c-overlay: #504945;
        --c-border: #59524d;
        --c-muted: #a1968d;
        --c-secondary-fg: #bdae93;
        --c-fg: #d5c4a1;
        --c-bright-fg: #ebdbb2;
        --c-highlight: #fbf1c7;
        --c-error: #ff4f39;
        --c-warn: #fe8019;
        --c-accent2: #fabd2f;
        --c-success: #b8bb26;
        --c-info: #8ec07c;
        --c-primary: #83a598;
        --c-secondary-accent: #d3869b;
        --c-special: #d65d0e;
        --c-border-strong: #88817c;
        --c-hover: #524b46;"
    `);
  });
});
