// The balance between today's pick and the picks beside it on the Home view:
// a ratio of the row's width given to the hero, dragged on the bar between
// the two (or nudged with the arrow keys on it), remembered across sessions.
// Same shape as the detail side peek's resize (usePeekResize): the DOM moves
// with the pointer and React state only commits when the drag ends.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export const HOME_SPLIT_KEY = "meguri.home.splitRatio";
export const HOME_SPLIT_DEFAULT = 0.5;
/** Neither side drops below a quarter of the row. */
export const HOME_SPLIT_MIN = 0.25;
export const HOME_SPLIT_MAX = 0.75;
const KEY_STEP = 0.02;

function clamp(ratio: number): number {
  return Math.min(HOME_SPLIT_MAX, Math.max(HOME_SPLIT_MIN, ratio));
}

function parseRatio(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? clamp(n) : HOME_SPLIT_DEFAULT;
}

/** The grid tracks for a ratio: hero, the bar, the picks. */
export function splitColumns(ratio: number): string {
  return `minmax(0, ${ratio}fr) auto minmax(0, ${1 - ratio}fr)`;
}

/** Whole percent for the separator's accessible value. */
export function splitPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

export function useHomeSplit(rowRef: RefObject<HTMLDivElement | null>) {
  const [ratio, setRatio] = useLocalStorage<number>(
    HOME_SPLIT_KEY,
    HOME_SPLIT_DEFAULT,
    parseRatio,
  );
  const ratioRef = useRef(ratio);
  useLayoutEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  // The drag in progress: one pointer at a time, finished on unmount so the
  // ratio reached is kept.
  const dragRef = useRef<{ pointerId: number; finish: () => void } | null>(
    null,
  );
  useEffect(() => () => dragRef.current?.finish(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    if (e.button !== 0 || !row || dragRef.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.focus();
    const { pointerId } = e;
    let next = ratioRef.current;
    let moved = false;
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const rect = row.getBoundingClientRect();
      if (rect.width === 0) return;
      moved = true;
      next = clamp((ev.clientX - rect.left) / rect.width);
      row.style.gridTemplateColumns = splitColumns(next);
      handle.setAttribute("aria-valuenow", String(splitPercent(next)));
    };
    const finish = () => {
      if (dragRef.current?.pointerId !== pointerId) return;
      dragRef.current = null;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      handle.removeEventListener("lostpointercapture", onEnd);
      if (moved) setRatio(next);
    };
    const onEnd = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    handle.setPointerCapture(pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    handle.addEventListener("lostpointercapture", onEnd);
    dragRef.current = { pointerId, finish };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Right gives the hero more room, left less.
    const delta =
      e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    // The shelves' own keyboard navigation listens on window; a key spent on
    // the bar must not move the card focus as well.
    e.stopPropagation();
    const next = clamp(ratioRef.current + delta);
    if (next !== ratioRef.current) setRatio(next);
  };

  const reset = () => {
    if (ratioRef.current !== HOME_SPLIT_DEFAULT) setRatio(HOME_SPLIT_DEFAULT);
  };

  return { ratio, onPointerDown, onKeyDown, reset } as const;
}
