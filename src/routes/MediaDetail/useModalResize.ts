import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { ModalSize } from "./MediaModal";

export const MODAL_DIMENSIONS_KEY = "meguri.media.detail.dimensions.v1";
export type ResizeEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "corner"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "move";
type Bounds = { width: number; height: number; left?: number; top?: number };
const MARGIN = 16;
const viewport = () => ({
  width: window.innerWidth - MARGIN * 2,
  height: window.innerHeight - MARGIN * 2,
});
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
function fit(value: Bounds, max: ReturnType<typeof viewport>) {
  const width = Math.round(
    clamp(value.width, Math.min(480, max.width), max.width),
  );
  const height = Math.round(
    clamp(value.height, Math.min(420, max.height), max.height),
  );
  return {
    width,
    height,
    left: Math.round(
      clamp(
        value.left ?? (max.width + MARGIN * 2 - width) / 2,
        MARGIN,
        max.width + MARGIN - width,
      ),
    ),
    top: Math.round(
      clamp(
        value.top ?? (max.height + MARGIN * 2 - height) / 2,
        MARGIN,
        max.height + MARGIN - height,
      ),
    ),
  };
}
function read(): Bounds | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(MODAL_DIMENSIONS_KEY) ?? "null",
    ) as Bounds | null;
    if (
      !value ||
      !Number.isFinite(value.width) ||
      !Number.isFinite(value.height) ||
      value.width <= 0 ||
      value.height <= 0
    )
      return null;
    return {
      width: value.width,
      height: value.height,
      left: Number.isFinite(value.left) ? value.left : undefined,
      top: Number.isFinite(value.top) ? value.top : undefined,
    };
  } catch {
    return null;
  }
}
function remember(value: Bounds) {
  try {
    localStorage.setItem(MODAL_DIMENSIONS_KEY, JSON.stringify(value));
  } catch {
    /* Resizing still works without storage. */
  }
}

/** Move from the title or resize around the opposite edge/corner. The frame is
 * clamped to the app viewport, while CSS keeps video and scenes together. */
export function useModalResize(
  active: boolean,
  size: ModalSize,
  panelRef: RefObject<HTMLDivElement | null>,
  onResize?: () => void,
) {
  const [bounds, setBounds] = useState(read);
  const [max, setMax] = useState(viewport);
  const drag = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active) return;
    const resize = () => setMax(viewport());
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active]);
  useEffect(() => () => drag.current?.(), []);
  const fitted = fit(
    size === "large"
      ? { ...max, left: MARGIN, top: MARGIN }
      : (bounds ?? {
          width: Math.min(960, Math.max(640, (max.width + MARGIN * 2) * 0.55)),
          height: Math.min(800, max.height * 0.9),
        }),
    max,
  );

  const adjust = (
    start: ReturnType<typeof fit>,
    edge: ResizeEdge,
    dx: number,
    dy: number,
  ) => {
    const m = viewport();
    if (edge === "move")
      return fit({ ...start, left: start.left + dx, top: start.top + dy }, m);
    let left = start.left,
      right = start.left + start.width,
      top = start.top,
      bottom = start.top + start.height;
    if (edge === "left" || edge === "topLeft" || edge === "bottomLeft")
      left = clamp(left + dx, MARGIN, right - Math.min(480, m.width));
    if (edge === "right" || edge === "topRight" || edge === "corner")
      right = clamp(
        right + dx,
        left + Math.min(480, m.width),
        m.width + MARGIN,
      );
    if (edge === "top" || edge === "topLeft" || edge === "topRight")
      top = clamp(top + dy, MARGIN, bottom - Math.min(420, m.height));
    if (edge === "bottom" || edge === "bottomLeft" || edge === "corner")
      bottom = clamp(
        bottom + dy,
        top + Math.min(420, m.height),
        m.height + MARGIN,
      );
    return fit({ left, top, width: right - left, height: bottom - top }, m);
  };
  const onPointerDown = (edge: ResizeEdge, e: PointerEvent<HTMLElement>) => {
    if (!active || e.button !== 0 || drag.current || !panelRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget,
      pointerId = e.pointerId;
    const rect = panelRef.current.getBoundingClientRect();
    const start = {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    const x = e.clientX,
      y = e.clientY;
    let next = start;
    setBounds(next);
    onResize?.();
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      next = adjust(start, edge, ev.clientX - x, ev.clientY - y);
      setBounds(next);
    };
    const finish = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", finish);
      remember(fit(next, viewport()));
    };
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    handle.setPointerCapture(pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", finish);
    handle.addEventListener("lostpointercapture", finish);
    drag.current = finish;
  };
  const onKeyDown = (edge: ResizeEdge, e: KeyboardEvent<HTMLElement>) => {
    const dx = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
    const dy = e.key === "ArrowDown" ? 16 : e.key === "ArrowUp" ? -16 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    e.stopPropagation();
    const next = adjust(fitted, edge, dx, dy);
    setBounds(next);
    onResize?.();
    remember(next);
  };
  return { ...fitted, max, onPointerDown, onKeyDown };
}
