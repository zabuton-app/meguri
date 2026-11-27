import { useEffect, useState, type RefObject } from "react";
import { usePanZoom } from "@/hooks/usePanZoom";
import { fitView, placeImage, type Size } from "@/lib/panZoom";

// Zoom and pan of the detail view's video (#637), with the behavior of the
// image's and the comparison's (usePanZoom.ts). The video and the adjusted
// picture drawn over it cannot be copied into a pane the way the image is, so
// the zoom is a transform on what holds them: the element itself is handed to
// and from the playlist player (videoHandOff.ts) and must not take a zoomed
// view along.
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
  const [natural, setNatural] = useState<Size | null>(null);

  // Also once the size was forgotten with the video still loaded: a reset and
  // an adopted element's load can land in the same render.
  useEffect(() => {
    const v = videoRef.current;
    if (enabled && loaded && !natural && v?.videoWidth && v.videoHeight)
      setNatural({ w: v.videoWidth, h: v.videoHeight });
  }, [enabled, loaded, natural, videoRef]);

  const zoom = usePanZoom({ enabled, stageRef, content: natural });

  let pictureStyle: React.CSSProperties | undefined;
  // How much larger than at fit the picture is drawn.
  let pictureScale = 1;
  if (zoom.view && zoom.placed && zoom.stage && natural) {
    const fitted = placeImage(fitView(zoom.fitZoom), zoom.stage, natural);
    const p = zoom.placed;
    const s = zoom.view.zoom / zoom.fitZoom;
    pictureScale = s;
    pictureStyle = {
      transform: `translate(${p.left - s * fitted.left}px, ${p.top - s * fitted.top}px) scale(${s})`,
      transformOrigin: "0 0",
    };
  }

  return {
    /** Whether the zoom controls can be offered: the video has a size. */
    ready: zoom.ready,
    zoomed: zoom.zoomed,
    dragging: zoom.dragging,
    percent: zoom.percent,
    canZoomIn: zoom.canZoomIn,
    zoomIn: zoom.zoomIn,
    zoomOut: zoom.zoomOut,
    fit: zoom.fit,
    /** Back to fit, forgetting the size: the next file has its own. */
    reset: () => {
      setNatural(null);
      zoom.reset();
    },
    /** Whether the click that ends the current press was a pan. */
    panned: zoom.panned,
    pictureStyle,
    pictureScale,
    panHandlers: zoom.panHandlers,
  };
}
