import { useEffect, useRef, useState, type RefObject } from "react";
import {
  BUTTON_STEP,
  imagePointAt,
  MAX_ZOOM,
  panBy,
  placeImage,
  wheelFactor,
  zoomTo,
  type Size,
  type ZoomView,
} from "./imageZoom";

/** How far a press moves before it pans instead of playing or pausing. */
const DRAG_THRESHOLD_PX = 4;

// Zoom and pan of the detail view's video (#637), with the math of the image's
// (imageZoom.ts) and its handling of the wheel (ZoomableImage.tsx): keep the
// two in step. The video and the adjusted picture drawn over it cannot be
// copied into a pane the way the image is, so the zoom is a transform on what
// holds them: the element itself is handed to and from the playlist player
// (videoHandOff.ts) and must not take a zoomed view along.
//
// The video fills the stage with `object-contain`, so the fitted picture is
// the view at the fit zoom centred in the stage, and the transform moves that
// fitted picture to where the zoomed view draws it. That holds as long as
// the holder and the adjusted picture's canvas both cover the stage exactly.
//
// The state belongs to one load of one file: the host resets it whenever it
// resets its playback, and turns it off while its stage is not mounted (the
// error screen), so the listeners attach to the stage that comes back.
export function useVideoZoom({
  enabled,
  loaded,
  stageRef,
  videoRef,
}: {
  enabled: boolean;
  /** Whether the video's metadata is in, so it has a size. */
  loaded: boolean;
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  // Null at fit.
  const [view, setView] = useState<ZoomView | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  // Whether the last press panned, so the click it ends in does not also play
  // or pause. Cleared by the next press.
  const pannedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const measure = () => {
    const r = rectOf(stageRef.current);
    if (r) setStage({ w: r.width, h: r.height });
    const v = videoRef.current;
    if (v?.videoWidth && v.videoHeight)
      setNatural({ w: v.videoWidth, h: v.videoHeight });
  };
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  });

  // Also once the sizes were forgotten with the video still loaded: a reset
  // and an adopted element's load can land in the same render.
  useEffect(() => {
    if (enabled && loaded && !natural) measureRef.current();
  }, [enabled, loaded, natural]);

  // The stage follows the window and the side peek's width.
  useEffect(() => {
    const el = stageRef.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, stageRef]);

  const fitted = enabled && stage && natural ? fitZoomOf(stage, natural) : 0;
  // A clip so small that fit is already the highest zoom has none to offer.
  const fit = fitted < MAX_ZOOM ? fitted : 0;
  // A view the stage has grown to fit (a wider window) is back at fit.
  const zoomed = view && fit && view.zoom > fit ? view : null;

  /** Zoom by `factor`, toward a client point or else the middle. */
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    const r = rectOf(stageRef.current);
    if (!r || !natural) return;
    const vp = { w: r.width, h: r.height };
    const f = fitZoomOf(vp, natural);
    if (!f || f >= MAX_ZOOM) return;
    setStage(vp);
    setView((prev) => {
      const from = prev && prev.zoom > f ? prev : fitView(f);
      const next = Math.min(MAX_ZOOM, from.zoom * factor);
      if (next <= f) return null;
      const vx = at ? at.x - r.left : vp.w / 2;
      const vy = at ? at.y - r.top : vp.h / 2;
      const p = imagePointAt(from, vx, vy, vp, natural);
      return zoomTo(next, p.x, p.y, vx, vy, vp, natural);
    });
  };

  // Native, not React's onWheel: React registers wheel listeners as passive,
  // and the window-wide Ctrl+wheel zoom (useContentZoom, on window) must be
  // kept from also seeing this event. A plain wheel is left to scroll the
  // detail view.
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheelRef.current = (e) => {
      // A video with no picture yet has nothing to zoom: leave the window zoom.
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

  /** Back to fit, forgetting the sizes: the next file has its own. */
  const reset = () => {
    setView(null);
    setStage(null);
    setNatural(null);
    endDrag();
  };

  let pictureStyle: React.CSSProperties | undefined;
  // How much larger than at fit the picture is drawn.
  let pictureScale = 1;
  if (zoomed && stage && natural) {
    const fitted = placeImage(fitView(fit), stage, natural);
    const p = placeImage(zoomed, stage, natural);
    const s = zoomed.zoom / fit;
    pictureScale = s;
    pictureStyle = {
      transform: `translate(${p.left - s * fitted.left}px, ${p.top - s * fitted.top}px) scale(${s})`,
      transformOrigin: "0 0",
    };
  }

  /** Handlers for what holds the video: a drag pans while zoomed in. */
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
      // The button is up although no pointerup arrived here.
      if (!(e.buttons & 1)) {
        endDrag();
        return;
      }
      if (!d.panning) {
        // Below the threshold it is still a click, which plays or pauses.
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX)
          return;
        d.panning = true;
        pannedRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
      const r = rectOf(stageRef.current);
      if (!r || !natural) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      press.current = { ...d, x: e.clientX, y: e.clientY };
      const vp = { w: r.width, h: r.height };
      setView((v) => v && panBy(v, dx, dy, vp, natural));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id === e.pointerId) endDrag();
    },
    // A press let go over something on top of the picture (the round play
    // button) never reaches pointerup here. Once panning, the capture keeps
    // the pointer here, so this only drops a press that was still a click.
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id === e.pointerId && !press.current.panning)
        endDrag();
    },
    // Also when the capture is lost without a pointerup reaching here (the
    // window losing the mouse mid-drag), or hovering would keep panning.
    onLostPointerCapture: endDrag,
    onPointerCancel: endDrag,
  };

  const zoom = zoomed?.zoom ?? fit;
  return {
    /** Whether the zoom controls can be offered: the video has a size. */
    ready: fit > 0,
    zoomed: zoomed != null,
    dragging,
    percent: Math.round(zoom * 100),
    canZoomIn: fit > 0 && zoom < MAX_ZOOM,
    zoomIn: () => zoomBy(BUTTON_STEP),
    zoomOut: () => zoomBy(1 / BUTTON_STEP),
    fit: () => setView(null),
    reset,
    /** Whether the click that ends the current press was a pan. */
    panned: () => pannedRef.current,
    pictureStyle,
    pictureScale,
    panHandlers,
  };
}

// The zoom at which `object-contain` draws the video in the stage.
function fitZoomOf(stage: Size, natural: Size): number {
  return Math.min(stage.w / natural.w, stage.h / natural.h);
}

function fitView(zoom: number): ZoomView {
  return { zoom, cx: 0.5, cy: 0.5 };
}

// The stage's size, read the same way by the drawing and by the handlers;
// null while it has no size.
function rectOf(el: Element | null) {
  const r = el?.getBoundingClientRect();
  return r && r.width && r.height ? r : null;
}
