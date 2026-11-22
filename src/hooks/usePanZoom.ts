import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  BUTTON_STEP,
  fitView,
  fitZoomOf,
  imagePointAt,
  MAX_ZOOM,
  panBy,
  placeImage,
  wheelFactor,
  zoomTo,
  type Placement,
  type Size,
  type ZoomView,
} from "@/lib/panZoom";

/** How far a press moves before it pans instead of clicking. */
const DRAG_THRESHOLD_PX = 4;

// Zoom and pan of a picture in a stage, one behavior for the detail view's
// image and video and for the image comparison (#647): Ctrl+wheel zooms toward
// the pointer (a plain wheel is left alone), the buttons and keys step by
// BUTTON_STEP, a double-click toggles fit and actual pixels, and a drag pans
// while zoomed in, clamped so no gap shows at an edge. The math is in
// lib/panZoom.ts; drawing the picture where `placed` says is the host's.
//
// The picture is assumed to be drawn at fit centered in the stage, as
// `object-contain` or a centered fitted box does, so zooming from fit keeps the
// spot under the pointer.
export function usePanZoom({
  enabled = true,
  stageRef,
  content,
}: {
  /** Off while the stage is not mounted, so the listeners attach to the one that comes back. */
  enabled?: boolean;
  stageRef: RefObject<HTMLElement | null>;
  /** The picture's size in its own pixels; null until it is known. */
  content: Size | null;
}) {
  // Null at fit.
  const [view, setView] = useState<ZoomView | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  // Whether the last press panned, so the click it ends in can be ignored.
  // Cleared by the next press.
  const pannedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const measure = () => {
    const r = rectOf(stageRef.current);
    if (r) setStage({ w: r.width, h: r.height });
  };
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  });

  // Before paint, so a picture drawn from `placed` does not flash at a stale
  // size; again whenever the picture's size changes.
  useLayoutEffect(() => {
    if (enabled) measureRef.current();
  }, [enabled, content?.w, content?.h]);

  // The stage follows the window and the side peek's width.
  useEffect(() => {
    const el = stageRef.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, stageRef]);

  const fitted = enabled && stage && content ? fitZoomOf(stage, content) : 0;
  // A picture so small that fit is already the highest zoom has none to offer.
  const fit = fitted < MAX_ZOOM ? fitted : 0;
  // A view the stage has grown to fit (a wider window) is back at fit.
  const zoomed = view && fit && view.zoom > fit ? view : null;

  /** Zoom to the level `next` picks, toward a client point or else the middle. */
  const zoomWith = (
    next: (from: number, fit: number) => number,
    at?: { x: number; y: number },
  ) => {
    const r = rectOf(stageRef.current);
    if (!enabled || !r || !content) return;
    const vp = { w: r.width, h: r.height };
    const f = fitZoomOf(vp, content);
    if (!f || f >= MAX_ZOOM) return;
    setStage(vp);
    setView((prev) => {
      const from = prev && prev.zoom > f ? prev : fitView(f);
      const zoom = Math.min(MAX_ZOOM, next(from.zoom, f));
      if (zoom <= f) return null;
      const vx = at ? at.x - r.left : vp.w / 2;
      const vy = at ? at.y - r.top : vp.h / 2;
      const p = imagePointAt(from, vx, vy, vp, content);
      return zoomTo(zoom, p.x, p.y, vx, vy, vp, content);
    });
  };
  const zoomBy = (factor: number, at?: { x: number; y: number }) =>
    zoomWith((from) => from * factor, at);

  // Native, not React's onWheel: React registers wheel listeners as passive,
  // and the window-wide Ctrl+wheel zoom (useContentZoom, on window) must be
  // kept from also seeing this event. A plain wheel is left to the page.
  // Read through a ref so the listener, registered once, sees the current
  // state.
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheelRef.current = (e) => {
      // A picture with no size yet has nothing to zoom: leave the window zoom.
      if (!e.ctrlKey || !fit) return;
      e.preventDefault();
      e.stopPropagation();
      zoomBy(wheelFactor(e.deltaY), { x: e.clientX, y: e.clientY });
    };
  });
  useEffect(() => {
    const el = stageRef.current;
    if (!enabled || !el) return;
    const onWheel = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, stageRef]);

  const endDrag = () => {
    press.current = null;
    setDragging(false);
  };

  /** Handlers for what takes the drag: it pans while zoomed in. */
  const panHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      pannedRef.current = false;
      if (!zoomed || e.button !== 0) return;
      // No text selection or native drag while panning. The click that
      // follows a press that does not move still arrives.
      e.preventDefault();
      press.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        panning: false,
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = press.current;
      if (!d || d.id !== e.pointerId) return;
      // The button is up although no pointerup arrived here: what took the
      // press was removed mid-drag (zoomed out to fit) and came back.
      if (!(e.buttons & 1)) {
        endDrag();
        return;
      }
      if (!d.panning) {
        // Below the threshold it is still a click.
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX)
          return;
        d.panning = true;
        pannedRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
      const r = rectOf(stageRef.current);
      if (!r || !content) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      press.current = { ...d, x: e.clientX, y: e.clientY };
      const vp = { w: r.width, h: r.height };
      setView((v) => v && panBy(v, dx, dy, vp, content));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id === e.pointerId) endDrag();
    },
    // A press let go over something on top (the video's round play button)
    // never reaches pointerup here. Once panning, the capture keeps the
    // pointer here, so this only drops a press that was still a click.
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id === e.pointerId && !press.current.panning)
        endDrag();
    },
    // Also when the capture is lost without a pointerup reaching here (the
    // window losing the mouse mid-drag), or hovering would keep panning.
    onLostPointerCapture: endDrag,
    onPointerCancel: endDrag,
  };

  const zoom = zoomed?.zoom ?? fitted;
  const placed: Placement | null =
    stage && content && fitted
      ? placeImage(zoomed ?? fitView(fitted), stage, content)
      : null;

  return {
    /** Whether there is anything to zoom: the picture and the stage have sizes. */
    ready: fit > 0,
    /** The zoomed view; null at fit. */
    view: zoomed,
    zoomed: zoomed != null,
    /** The zoom shown, in the picture's pixels; at fit, the fit. */
    zoom,
    /** The zoom at fit; 0 while there is no size. */
    fitZoom: fitted,
    stage,
    /** Where the picture is drawn in the stage, at fit or zoomed. */
    placed,
    dragging,
    percent: Math.round(zoom * 100),
    canZoomIn: fit > 0 && zoom < MAX_ZOOM,
    zoomIn: () => zoomBy(BUTTON_STEP),
    zoomOut: () => zoomBy(1 / BUTTON_STEP),
    fit: () => setView(null),
    /** Double-click: back to fit, or actual pixels at a client point. */
    toggle: (at?: { x: number; y: number }) => {
      if (zoomed) setView(null);
      else zoomWith((_, f) => Math.max(1, f), at);
    },
    /** Back to fit, ending a drag. */
    reset: () => {
      setView(null);
      endDrag();
    },
    /** Whether the click that ends the current press was a pan. */
    panned: () => pannedRef.current,
    panHandlers,
  };
}

// The stage's size, read the same way by the drawing and by the handlers;
// null while it has no size.
function rectOf(el: Element | null) {
  const r = el?.getBoundingClientRect();
  return r && r.width && r.height ? r : null;
}
