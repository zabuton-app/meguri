import { useEffect, useRef, useState } from "react";
import { Shrink, ZoomIn, ZoomOut } from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";
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

// The detail view's image, which can be zoomed and panned. Zoom with Ctrl+wheel
// (toward the pointer), the buttons at the lower right, or a double-click (fit
// ↔ actual pixels); drag to pan while zoomed in.
//
// The stage keeps the size it has at fit. Zoomed in, the image is drawn over
// the whole stage, bars beside the fitted image included, rather than inside
// the fitted image's box.
//
// The host keys this on the file, so moving to another file starts at fit.
export function ZoomableImage({
  src,
  alt,
  inverted,
  t,
}: {
  src: string;
  alt: string;
  /** White background instead of black. */
  inverted: boolean;
  t: TFunc;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Null at fit.
  const [view, setView] = useState<ZoomView | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  // The fitted image's width over its natural width: the zoom at fit.
  const [fitZoom, setFitZoom] = useState(0);
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const stageRect = () => rectOf(stageRef.current);

  const measure = () => {
    const r = stageRect();
    if (r) setStageSize({ w: r.width, h: r.height });
    const img = imgRef.current;
    const box = boxRef.current;
    if (!box || !img || !img.naturalWidth || !img.naturalHeight) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setFitZoom(box.clientWidth / img.naturalWidth);
  };
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  });

  // The stage and the fitted image follow the window and the side peek's
  // width; so do the level shown at fit and the point below which zooming out
  // returns to fit.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  /** Zoom by `factor`, toward a client point or else the middle. */
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    const r = stageRect();
    if (!r || !natural || !fitZoom) return;
    const vp = { w: r.width, h: r.height };
    setStageSize(vp);
    setView((prev) => {
      const next = (prev?.zoom ?? fitZoom) * factor;
      if (next <= fitZoom) return null;
      const vx = at ? at.x - r.left : vp.w / 2;
      const vy = at ? at.y - r.top : vp.h / 2;
      if (prev) {
        const p = imagePointAt(prev, vx, vy, vp, natural);
        return zoomTo(next, p.x, p.y, vx, vy, vp, natural);
      }
      // From fit: the spot of the fitted image under the point stays put.
      const b = boxRef.current?.getBoundingClientRect();
      if (!b || !b.width || !b.height)
        return zoomTo(next, 0.5, 0.5, vx, vy, vp, natural);
      return zoomTo(
        next,
        (r.left + vx - b.left) / b.width,
        (r.top + vy - b.top) / b.height,
        vx,
        vy,
        vp,
        natural,
      );
    });
  };

  // Native, not React's onWheel: React registers wheel listeners as passive,
  // and the window-wide Ctrl+wheel zoom (useContentZoom, on window) must be
  // kept from also seeing this event. A plain wheel is left to scroll the
  // detail view. Read through a ref so the listener, registered once, sees the
  // current state.
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheelRef.current = (e) => {
      // An image that never loaded has nothing to zoom: leave the window zoom.
      if (!e.ctrlKey || !natural || !fitZoom) return;
      e.preventDefault();
      e.stopPropagation();
      zoomBy(wheelFactor(e.deltaY), { x: e.clientX, y: e.clientY });
    };
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => onWheelRef.current(e);
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const zoom = view?.zoom ?? fitZoom;
  const placed =
    view && natural && stageSize && placeImage(view, stageSize, natural);

  return (
    <div
      ref={stageRef}
      className={`group relative flex justify-center overflow-hidden rounded-card ${
        inverted ? "bg-white" : "bg-black"
      }`}
    >
      <div
        ref={boxRef}
        data-slot="zoomable-image"
        className="relative max-w-full"
        onDoubleClick={(e) => {
          // Actual pixels, unless the image already fits at or below them.
          if (fitZoom < 1) zoomBy(1 / fitZoom, { x: e.clientX, y: e.clientY });
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          onLoad={measure}
          // Hidden rather than removed while zoomed: it keeps the stage at the
          // size it has at fit.
          className={`block max-h-[78vh] max-w-full object-contain ${
            placed ? "invisible" : ""
          }`}
        />
      </div>
      {placed && (
        <div
          data-slot="image-zoom-pane"
          className={`absolute inset-0 touch-none ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          onDoubleClick={() => setView(null)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            // The button is up although no pointerup arrived here: the pane
            // was closed mid-drag (zoomed out to fit) and opened again.
            if (!(e.buttons & 1)) {
              endDrag();
              return;
            }
            const r = stageRect();
            if (!r || !natural) return;
            drag.current = { id: d.id, x: e.clientX, y: e.clientY };
            const vp = { w: r.width, h: r.height };
            setView(
              (v) =>
                v && panBy(v, e.clientX - d.x, e.clientY - d.y, vp, natural),
            );
          }}
          onPointerUp={(e) => {
            if (drag.current?.id === e.pointerId) endDrag();
          }}
          // Also when the capture is lost without a pointerup reaching here
          // (the window losing the mouse mid-drag), or hovering would keep
          // panning.
          onLostPointerCapture={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            className="absolute left-0 top-0 max-w-none select-none"
            style={{
              width: placed.width,
              height: placed.height,
              transform: `translate(${placed.left}px, ${placed.top}px)`,
            }}
          />
        </div>
      )}
      {fitZoom > 0 && (
        <ZoomControls
          percent={Math.round(zoom * 100)}
          zoomed={view != null}
          canZoomIn={zoom < MAX_ZOOM}
          onZoomOut={() => zoomBy(1 / BUTTON_STEP)}
          onZoomIn={() => zoomBy(BUTTON_STEP)}
          onFit={() => setView(null)}
          t={t}
        />
      )}
    </div>
  );
}

// One source for the stage's size, read the same way by the drawing and by the
// event handlers that work in its coordinates; null while it has no size.
function rectOf(el: Element | null) {
  const r = el?.getBoundingClientRect();
  return r && r.width && r.height ? r : null;
}

function ZoomControls({
  percent,
  zoomed,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onFit,
  t,
}: {
  percent: number;
  zoomed: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  t: TFunc;
}) {
  const buttonClass =
    "flex h-7 w-7 items-center justify-center rounded-control text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40";
  return (
    <div
      className={`absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-control border border-white/30 bg-black/70 p-0.5 text-white shadow-sm transition-opacity duration-200 motion-reduce:transition-none ${
        zoomed
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      }`}
    >
      <button
        type="button"
        className={buttonClass}
        onClick={onZoomOut}
        disabled={!zoomed}
        aria-label={t("media.zoomOut")}
        title={t("media.zoomOut")}
      >
        <ZoomOut size={16} aria-hidden="true" />
      </button>
      <span className="min-w-12 text-center text-xs tabular-nums">
        {percent}%
      </span>
      <button
        type="button"
        className={buttonClass}
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label={t("media.zoomIn")}
        title={t("media.zoomIn")}
      >
        <ZoomIn size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={onFit}
        disabled={!zoomed}
        aria-label={t("media.zoomFit")}
        title={t("media.zoomFit")}
      >
        <Shrink size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
