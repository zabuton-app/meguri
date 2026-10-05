// Where the hover thumbnail (GraphHoverThumbnail) goes beside the pointer.

/** The most room the card takes, in CSS pixels. The card itself takes the
 *  thumbnail's shape inside it (see fitThumbnail). */
export const THUMBNAIL_WIDTH = 192;
export const THUMBNAIL_HEIGHT = 144;
/** The card's shortest side: a very long or very wide picture is cropped to
 *  this rather than shown as a sliver. */
export const THUMBNAIL_MIN_SIDE = 48;
/** Distance kept between the pointer and the card. */
export const THUMBNAIL_GAP = 14;
/** Distance kept between the card and the box's edge. */
export const THUMBNAIL_MARGIN = 4;

/** The card's size for a picture of the given natural size: as large as the
 *  box allows at the picture's own aspect ratio, so no margin shows around
 *  it (short of THUMBNAIL_MIN_SIDE). The whole box while the size is not
 *  known. */
export function fitThumbnail(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!(naturalWidth > 0) || !(naturalHeight > 0))
    return { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };
  const scale = Math.min(
    THUMBNAIL_WIDTH / naturalWidth,
    THUMBNAIL_HEIGHT / naturalHeight,
  );
  return {
    width: Math.max(THUMBNAIL_MIN_SIDE, Math.round(naturalWidth * scale)),
    height: Math.max(THUMBNAIL_MIN_SIDE, Math.round(naturalHeight * scale)),
  };
}

/** Where a card of the given size goes for a pointer at (x, y) in a box:
 *  up and to the right of the pointer (the node's label is drawn below it),
 *  flipped to the other side where it would leave the box. */
export function thumbnailPosition(
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
  width = THUMBNAIL_WIDTH,
  height = THUMBNAIL_HEIGHT,
): { left: number; top: number } {
  let left = x + THUMBNAIL_GAP;
  if (left + width + THUMBNAIL_MARGIN > boxWidth)
    left = x - THUMBNAIL_GAP - width;
  let top = y - THUMBNAIL_GAP - height;
  if (top < THUMBNAIL_MARGIN) top = y + THUMBNAIL_GAP;
  const clamp = (v: number, size: number, box: number) =>
    Math.max(THUMBNAIL_MARGIN, Math.min(v, box - size - THUMBNAIL_MARGIN));
  return {
    left: clamp(left, width, boxWidth),
    top: clamp(top, height, boxHeight),
  };
}
