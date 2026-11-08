// docs/theming.md promises that the sample themes in docs/themes/ meet the
// contrast minimums the built-in schemes are corrected to (FLOORS in
// src/themes/derive.ts). A stylesheet is applied as written, so nothing else
// would catch a sample edited below them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/themes/color";
import { FLOORS } from "@/themes/derive";

const THEMES_DIR = path.join(process.cwd(), "docs/themes");
const files = fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith(".css"));

type Palette = Record<string, `#${string}`>;

/** The --c-* hex values declared in each html[data-appearance="..."] block. */
function palettes(css: string): Map<string, Palette> {
  const out = new Map<string, Palette>();
  const block = /html\[data-appearance="(\w+)"\]\s*\{([^}]*)\}/g;
  for (const [, appearance, body] of css.matchAll(block)) {
    const palette: Palette = {};
    for (const [, name, hex] of body.matchAll(
      /--c-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g,
    )) {
      palette[name] = hex as `#${string}`;
    }
    out.set(appearance, palette);
  }
  return out;
}

const [mutedVsBg, mutedVsSurface] = FLOORS.muted;
const [overlayVsBg, overlayVsSurface] = FLOORS.overlay;

// [foreground, background, minimum]. Mirrors the floors derive.test.ts checks
// for the built-in schemes, and the table in docs/theming.md. The sample is
// held to 4.5 for every accent, stricter than the built-in accent2 floor.
const PAIRS: [string, string, number][] = [
  ["fg", "bg", FLOORS.fg],
  ["fg", "surface", FLOORS.fg],
  ["bright-fg", "bg", FLOORS.brightFg],
  ["muted", "bg", mutedVsBg],
  ["muted", "surface", mutedVsSurface],
  ["fg", "overlay", FLOORS.textOnRaised],
  ["bright-fg", "hover", FLOORS.textOnRaised],
  ["border", "bg", FLOORS.border],
  ["border", "surface", FLOORS.border],
  ["border-strong", "bg", FLOORS.borderStrong],
  ["border-strong", "surface", FLOORS.borderStrong],
  ["overlay", "bg", overlayVsBg],
  ["overlay", "surface", overlayVsSurface],
  ["hover", "surface", FLOORS.hover],
  // Text on a primary fill is drawn in --c-bg.
  ["bg", "primary", FLOORS.accentText],
  ...(
    [
      "primary",
      "error",
      "warn",
      "success",
      "info",
      "accent2",
      "secondary-accent",
    ] as const
  ).map((accent): [string, string, number] => [
    accent,
    "bg",
    FLOORS.accentText,
  ]),
];

describe.each(files)("docs/themes/%s", (file) => {
  const found = palettes(fs.readFileSync(path.join(THEMES_DIR, file), "utf8"));

  it("has a dark and a light variant", () => {
    expect([...found.keys()].sort()).toEqual(["dark", "light"]);
  });

  describe.each(["dark", "light"])("%s", (appearance) => {
    const palette = found.get(appearance) ?? {};
    it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, min) => {
      expect(palette[fg], `--c-${fg}`).toBeDefined();
      expect(palette[bg], `--c-${bg}`).toBeDefined();
      expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(
        min,
      );
    });
  });
});
