import { useRef, useState } from "react";
import { Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { usePanZoom } from "@/hooks/usePanZoom";
import type { Size } from "@/lib/panZoom";
import type { TFunc } from "@/i18n/I18nProvider";

// The detail view's image, which can be zoomed and panned (usePanZoom.ts).
// Zoom with Ctrl+wheel (toward the pointer), the buttons at the lower right, or
// a double-click (fit ↔ actual pixels); drag to pan while zoomed in.
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
  const [natural, setNatural] = useState<Size | null>(null);
  // The stage is as tall as the fitted image and centers it across, so its fit
  // is the fitted image's.
  const zoom = usePanZoom({ stageRef, content: natural });
  const placed = zoom.view && zoom.placed;

  return (
    <div
      ref={stageRef}
      className={`group relative flex justify-center overflow-hidden rounded-card ${
        inverted ? "bg-white" : "bg-black"
      }`}
    >
      <div
        data-slot="zoomable-image"
        className="relative max-w-full"
        onDoubleClick={(e) => zoom.toggle({ x: e.clientX, y: e.clientY })}
      >
        <img
          src={src}
          alt={alt}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight)
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
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
            zoom.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          onDoubleClick={() => zoom.toggle()}
          {...zoom.panHandlers}
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
      {zoom.ready && (
        <ZoomControls
          percent={zoom.percent}
          zoomed={zoom.zoomed}
          canZoomIn={zoom.canZoomIn}
          onZoomOut={zoom.zoomOut}
          onZoomIn={zoom.zoomIn}
          onFit={zoom.fit}
          t={t}
        />
      )}
    </div>
  );
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
