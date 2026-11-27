// Where a filmstrip row takes its frames, and how large they are drawn.

/**
 * Times (whole seconds) of `count` frames spread evenly over `duration`, each
 * at the middle of its slice: no black first frame, no frame past the end.
 * The same spacing as the scene strips (SceneRail).
 */
export function frameTimes(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    Math.floor((duration * (i + 0.5)) / count),
  );
}

// The row's horizontal measures, kept here so the width left for the strip
// can be worked out from the view's width alone (every row has the same).
export const VIEW_PAD_X = 12;
export const ROW_PAD = 8;
export const LEFT_COL_W = 256;
export const ROW_GAP = 16;
/** What the view's width loses before the strip: paddings, left column, gap. */
export const STRIP_CHROME = 2 * VIEW_PAD_X + 2 * ROW_PAD + LEFT_COL_W + ROW_GAP;

export const FRAME_GAP = 4;
/** Narrowest a frame gets; a strip too narrow for that scrolls sideways. */
export const FRAME_MIN_W = 64;

export type StripLayout = { frameW: number; frameH: number; scrolls: boolean };

/** Below this much strip beside the details, the details go above the strip. */
export const STACK_BELOW_STRIP_W = 320;

export type RowLayout = StripLayout & {
  /** Details above the strip, each the row's full width (a narrow view, such
   *  as the list beside a docked side peek). */
  stacked: boolean;
};

/** How every row is laid out in a view `viewWidth` wide. */
export function rowLayout(viewWidth: number, count: number): RowLayout {
  const stacked = viewWidth - STRIP_CHROME < STACK_BELOW_STRIP_W;
  const stripWidth = stacked
    ? viewWidth - 2 * VIEW_PAD_X - 2 * ROW_PAD
    : viewWidth - STRIP_CHROME;
  return { ...stripLayout(stripWidth, count), stacked };
}

/**
 * Frame boxes for a strip `stripWidth` wide: `count` 16:9 boxes sharing it,
 * so the strip spans the row, the height following the width. A video of
 * another aspect sits inside its box whole (letterboxed).
 */
export function stripLayout(stripWidth: number, count: number): StripLayout {
  const share = Math.floor(
    (stripWidth - Math.max(0, count - 1) * FRAME_GAP) / count,
  );
  const scrolls = share < FRAME_MIN_W;
  const frameW = scrolls ? FRAME_MIN_W : share;
  return { frameW, frameH: Math.round((frameW * 9) / 16), scrolls };
}
