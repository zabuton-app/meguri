// Zoom and pan of a picture in a viewport, as plain math: the detail view's
// image and video, and the image comparison's box that holds both images
// (usePanZoom.ts handles the input).
//
// "Image" here is whatever is zoomed, of any size. The view is kept in terms
// that do not depend on the viewport's size: the zoom in the image's pixels (1
// is 100%), and the point of the image (as fractions of its width and height)
// at the viewport's center.

export interface Size {
  w: number;
  h: number;
}

export interface ZoomView {
  /** Multiple of the image's actual pixels; 1 is 100%. */
  zoom: number;
  /** The point of the image at the viewport's center, as fractions. */
  cx: number;
  cy: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The highest zoom: 800% of actual pixels. */
export const MAX_ZOOM = 8;

/** Step of the zoom buttons. */
export const BUTTON_STEP = 1.25;

/** How much one wheel notch (deltaY 100) zooms. */
const WHEEL_NOTCH = 1.2;

export function wheelFactor(deltaY: number): number {
  return Math.pow(WHEEL_NOTCH, -deltaY / 100);
}

/** The zoom that fits the image in the viewport; 0 while either has no size. */
export function fitZoomOf(viewport: Size, image: Size): number {
  if (!(viewport.w > 0 && viewport.h > 0 && image.w > 0 && image.h > 0))
    return 0;
  return Math.min(viewport.w / image.w, viewport.h / image.h);
}

/** The view at fit: the whole image, centered. */
export function fitView(zoom: number): ZoomView {
  return { zoom, cx: 0.5, cy: 0.5 };
}

// One axis: an image narrower than the viewport sits in the middle; a wider one
// is kept from showing a gap at either edge.
function place(center: number, size: number, viewport: number): number {
  if (size <= viewport) return (viewport - size) / 2;
  return Math.min(0, Math.max(viewport - size, viewport / 2 - center * size));
}

/** Where the image is drawn in the viewport, in pixels. */
export function placeImage(
  view: ZoomView,
  viewport: Size,
  image: Size,
): Placement {
  const width = image.w * view.zoom;
  const height = image.h * view.zoom;
  return {
    left: place(view.cx, width, viewport.w),
    top: place(view.cy, height, viewport.h),
    width,
    height,
  };
}

// Store the center the image is actually drawn at, so a pan pushed past an edge
// does not have to be undone before it moves the other way.
function settle(view: ZoomView, viewport: Size, image: Size): ZoomView {
  const p = placeImage(view, viewport, image);
  return {
    zoom: view.zoom,
    cx: (viewport.w / 2 - p.left) / p.width,
    cy: (viewport.h / 2 - p.top) / p.height,
  };
}

/** The point of the image under a point of the viewport, as fractions. */
export function imagePointAt(
  view: ZoomView,
  vx: number,
  vy: number,
  viewport: Size,
  image: Size,
): { x: number; y: number } {
  const p = placeImage(view, viewport, image);
  return { x: (vx - p.left) / p.width, y: (vy - p.top) / p.height };
}

/**
 * Zoom to `zoom` (capped at MAX_ZOOM) with the image's point (ix, iy) under the
 * viewport's point (vx, vy): toward the pointer, the spot under it stays put.
 */
export function zoomTo(
  zoom: number,
  ix: number,
  iy: number,
  vx: number,
  vy: number,
  viewport: Size,
  image: Size,
): ZoomView {
  const z = Math.min(MAX_ZOOM, zoom);
  return settle(
    {
      zoom: z,
      cx: ix + (viewport.w / 2 - vx) / (image.w * z),
      cy: iy + (viewport.h / 2 - vy) / (image.h * z),
    },
    viewport,
    image,
  );
}

/** Move the image by (dx, dy) pixels of the viewport. */
export function panBy(
  view: ZoomView,
  dx: number,
  dy: number,
  viewport: Size,
  image: Size,
): ZoomView {
  return settle(
    {
      zoom: view.zoom,
      cx: view.cx - dx / (image.w * view.zoom),
      cy: view.cy - dy / (image.h * view.zoom),
    },
    viewport,
    image,
  );
}
