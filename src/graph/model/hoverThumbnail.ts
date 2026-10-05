// Where the hover thumbnail (GraphHoverThumbnail) goes beside the pointer.

/** The card's box, in CSS pixels (the thumbnail is fitted inside it). */
export const THUMBNAIL_WIDTH = 192;
export const THUMBNAIL_HEIGHT = 144;
/** Distance kept between the pointer and the card. */
export const THUMBNAIL_GAP = 14;
/** Distance kept between the card and the box's edge. */
export const THUMBNAIL_MARGIN = 4;

/** Where the card goes for a pointer at (x, y) in a box of the given size:
 *  up and to the right of the pointer (the node's label is drawn below it),
 *  flipped to the other side where it would leave the box. */
export function thumbnailPosition(
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
): { left: number; top: number } {
  let left = x + THUMBNAIL_GAP;
  if (left + THUMBNAIL_WIDTH + THUMBNAIL_MARGIN > boxWidth)
    left = x - THUMBNAIL_GAP - THUMBNAIL_WIDTH;
  let top = y - THUMBNAIL_GAP - THUMBNAIL_HEIGHT;
  if (top < THUMBNAIL_MARGIN) top = y + THUMBNAIL_GAP;
  const clamp = (v: number, size: number, box: number) =>
    Math.max(THUMBNAIL_MARGIN, Math.min(v, box - size - THUMBNAIL_MARGIN));
  return {
    left: clamp(left, THUMBNAIL_WIDTH, boxWidth),
    top: clamp(top, THUMBNAIL_HEIGHT, boxHeight),
  };
}
