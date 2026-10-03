// Grid → SVG conversion for the pet sprites, shared by the app and the
// standalone preview page (tools/pet-preview).

import {
  PET_HEIGHT,
  PET_SYMBOLS,
  PET_WIDTH,
  type PetFrame,
  type PetRole,
} from "./petSprites";

export type PetAppearance = "light" | "dark";

/**
 * Role → color. The character keeps its brand colors (navy, gold, beige) in
 * every theme; only the outline follows the theme's appearance, so the navy
 * body never sinks into a dark background. Theme-following or seasonal
 * variants only need to swap this table.
 */
export const PET_ROLE_COLORS: Readonly<
  Record<PetRole, string | Readonly<Record<PetAppearance, string>>>
> = {
  outline: { light: "#0b1520", dark: "#f6efe0" },
  body: "#132537",
  bodyShade: "#0b1826",
  bodyLight: "#243a55",
  stitch: "#d9b062",
  tassel: "#b27f31",
  face: "#f6efe0",
};

export function petRoleColor(role: PetRole, appearance: PetAppearance): string {
  const color = PET_ROLE_COLORS[role];
  return typeof color === "string" ? color : color[appearance];
}

/** A horizontal run of same-role pixels, one pixel tall. */
export interface PetRect {
  x: number;
  y: number;
  width: number;
  role: PetRole;
}

/**
 * Turn a frame into rects, merging horizontal runs of the same role so a frame
 * comes out at a few dozen rects instead of one per pixel. Unknown symbols
 * are treated as transparent.
 */
export function frameToRects(frame: PetFrame): PetRect[] {
  const rects: PetRect[] = [];
  frame.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const role = PET_SYMBOLS[row[x]];
      if (!role) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && PET_SYMBOLS[row[end]] === role) end += 1;
      rects.push({ x, y, width: end - x, role });
      x = end;
    }
  });
  return rects;
}

/**
 * Standalone SVG markup for a frame at `scale` CSS px per pixel. The app
 * renders the same rects through React; this string form serves the preview.
 */
export function frameToSvg(
  frame: PetFrame,
  { scale, appearance }: { scale: number; appearance: PetAppearance },
): string {
  const rects = frameToRects(frame)
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="1" fill="${petRoleColor(r.role, appearance)}"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PET_WIDTH} ${PET_HEIGHT}"` +
    ` width="${PET_WIDTH * scale}" height="${PET_HEIGHT * scale}" shape-rendering="crispEdges">` +
    rects +
    `</svg>`
  );
}
