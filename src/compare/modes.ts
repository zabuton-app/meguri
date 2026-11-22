// The ways to look at the pair. Each is a style for the layer of A and the
// layer of B, which the stage draws one over the other at the same transform.
import type { CSSProperties } from "react";

export const MODES = ["slider", "difference", "onion", "blink"] as const;
export type CompareMode = (typeof MODES)[number];

export interface ModeState {
  /** The slider's split, 0 (all B) to 1 (all A), of the stage's width. */
  split: number;
  /** B's opacity in the onion skin. */
  opacity: number;
  /** Whether the blink shows B. */
  blinkB: boolean;
}

export function layerStyles(
  mode: CompareMode,
  { split, opacity, blinkB }: ModeState,
): { a: CSSProperties; b: CSSProperties } {
  switch (mode) {
    case "slider":
      // Complementary clips in stage space. A is clipped too: where B does
      // not cover the view (a crop, a transparent area), the right of the
      // split must not show A.
      return {
        a: { clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` },
        b: { clipPath: `inset(0 0 0 ${split * 100}%)` },
      };
    case "difference":
      // Identical pixels go black.
      return { a: {}, b: { mixBlendMode: "difference" } };
    case "onion":
      return { a: {}, b: { opacity } };
    case "blink":
      return blinkB
        ? { a: { visibility: "hidden" }, b: {} }
        : { a: {}, b: { visibility: "hidden" } };
  }
}
