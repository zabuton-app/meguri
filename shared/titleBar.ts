// Sizes of the custom title bar (#578) that main and the renderer both need:
// main places macOS's traffic lights for the bar before the renderer moves
// them, and the crash screen draws a stand-in bar of the same height.

/** Height of the title bar in px at zoom 1. styles.css sets the same height
 *  as --meguri-title-bar-height (3rem), which CSS cannot import. */
export const TITLE_BAR_HEIGHT = 48;

/** macOS's traffic light buttons, in screen px (they do not zoom). */
export const TRAFFIC_LIGHTS = { width: 52, height: 14 } as const;
