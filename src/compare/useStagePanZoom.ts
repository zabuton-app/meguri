// Zoom and pan of the comparison stage: the wheel zooms around the cursor,
// a drag pans, and the stage's size is measured for the fit.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { FIT_VIEW, zoomAt, type View } from "./viewport";

export function useStagePanZoom(stageRef: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<View>(FIT_VIEW);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () =>
      setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef]);

  const zoomBy = useCallback((factor: number, at = { x: 0, y: 0 }) => {
    setView((v) => zoomAt(v, factor, at));
  }, []);
  const fit = useCallback(() => setView(FIT_VIEW), []);

  // Not React's onWheel: that listener is passive, and the wheel has to be
  // kept from scrolling the page underneath.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel stays the app's own zoom (useContentZoom).
      if (e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.002), {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, zoomBy]);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const endDrag = () => {
    drag.current = null;
  };
  const panHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const from = drag.current;
      if (!from) return;
      drag.current = { x: e.clientX, y: e.clientY };
      setView((v) => ({
        ...v,
        panX: v.panX + e.clientX - from.x,
        panY: v.panY + e.clientY - from.y,
      }));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    // A capture lost with the button still down (the window losing focus)
    // sends no pointerup; without this the next hover would keep panning.
    onLostPointerCapture: endDrag,
  };

  return { view, stage, zoomBy, fit, panHandlers };
}
