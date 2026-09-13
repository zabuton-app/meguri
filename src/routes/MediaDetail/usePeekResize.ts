// Width of the detail side peek and the drag handle that changes it. The sheet
// is a flex sibling of Home's list, so its width is what the list gives up:
// it is kept between PEEK_MIN_WIDTH and whatever leaves the list
// LIST_MIN_WIDTH of room, re-fitted whenever the window changes size, and
// remembered across sessions. While the sheet is docked its width is published
// as a CSS variable so viewport-anchored overlays (Home's floating action
// buttons) can move left out from under it — the same arrangement as the
// player bar's `--meguri-player-bar-inset`.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

// Detail-only (unlike MODAL_SIZE_KEY, which Discover shares), hence the
// `detail` segment.
export const PEEK_WIDTH_KEY = "meguri.media.detail.peekWidth";
export const PEEK_DEFAULT_WIDTH = 520;
export const PEEK_MIN_WIDTH = 320;
/** Room the list keeps beside the sheet. Home's `<main>` states the same
 *  minimum, so the flex row and this clamp agree. */
export const LIST_MIN_WIDTH = 240;
const KEY_STEP = 16;
const PEEK_INSET_VAR = "--meguri-peek-inset";

/** Only the floor is checked here, since the ceiling depends on the window —
 *  the fit effect applies it on docking. */
function parseWidth(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= PEEK_MIN_WIDTH
    ? Math.round(n)
    : PEEK_DEFAULT_WIDTH;
}

/** The flex row the sheet shares with the list: the nearest ancestor that has
 *  a box (the frame's outer div is `display: contents` and measures 0). */
function rowOf(panel: HTMLElement | null): HTMLElement | null {
  let el = panel?.parentElement ?? null;
  while (el && el.clientWidth === 0) el = el.parentElement;
  return el;
}

function maxWidthFor(panel: HTMLElement | null): number {
  const row = rowOf(panel);
  return row
    ? Math.max(PEEK_MIN_WIDTH, row.clientWidth - LIST_MIN_WIDTH)
    : Infinity;
}

function clamp(width: number, max: number): number {
  return Math.round(Math.min(max, Math.max(PEEK_MIN_WIDTH, width)));
}

function publishInset(px: number): void {
  const root = document.documentElement;
  const next = `${px}px`;
  // Rewriting a :root custom property invalidates styles that depend on it,
  // so only touch it when the value moved (a drag calls this every frame).
  if (root.style.getPropertyValue(PEEK_INSET_VAR) === next) return;
  root.style.setProperty(PEEK_INSET_VAR, next);
}

interface Drag {
  pointerId: number;
  finish: () => void;
}

export function usePeekResize(
  docked: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
) {
  // Unlike the modal size and the presentation, which the route owns, the
  // width lives here in the frame: nothing but the frame reads it, and held
  // by the route it would re-render the whole detail view (player included)
  // on every keyboard step and every frame of a window resize.
  const [width, setWidth] = useLocalStorage<number>(
    PEEK_WIDTH_KEY,
    PEEK_DEFAULT_WIDTH,
    parseWidth,
  );
  // The current ceiling, for the handle's aria-valuemax.
  const [max, setMax] = useState(Infinity);

  // Fit on docking and on every window resize: a width remembered from a
  // wider window (or a wider layout) must never squeeze the list below its
  // minimum. Layout effect so the first paint is already fitted.
  useLayoutEffect(() => {
    if (!docked) return;
    const fit = () => {
      const m = maxWidthFor(panelRef.current);
      // Clamping a stored value to the measured layout is what this effect
      // is for; it settles in one pass (the clamp is idempotent).
      setMax(m);
      setWidth((w) => clamp(w, m));
    };
    fit();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [docked, panelRef, setWidth]);

  // Layout effect so the FABs have moved in the frame the sheet first paints.
  useLayoutEffect(() => {
    if (!docked) return;
    publishInset(width);
    return () => publishInset(0);
  }, [docked, width]);

  // The drag in progress, if any: one pointer at a time, and finished on
  // unmount (Esc closes the view mid-drag) so the width reached is kept.
  const drag = useRef<Drag | null>(null);
  useEffect(() => () => drag.current?.finish(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (e.button !== 0 || !panel || drag.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    // preventDefault above keeps the click from focusing the handle; do it
    // here so Arrow keys refine the width right after grabbing it.
    handle.focus();
    const { pointerId } = e;
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const m = maxWidthFor(panel);
    let next = clamp(startWidth, m);
    let moved = false;
    // Live: the DOM and the inset move with the pointer, React state only
    // when the drag ends, so the frame (and the player inside it) is not
    // re-rendered per pointer move.
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      moved = true;
      // The edge moves left to grow: pointer travel is subtracted.
      next = clamp(startWidth + (startX - ev.clientX), m);
      panel.style.width = `${next}px`;
      handle.setAttribute("aria-valuenow", String(next));
      publishInset(next);
    };
    const finish = () => {
      if (drag.current?.pointerId !== pointerId) return;
      drag.current = null;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      handle.removeEventListener("lostpointercapture", onEnd);
      if (moved) setWidth(next);
    };
    const onEnd = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    handle.setPointerCapture(pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    handle.addEventListener("lostpointercapture", onEnd);
    drag.current = { pointerId, finish };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Left grows the sheet (its edge moves left), right shrinks it.
    const delta =
      e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    setWidth((w) => clamp(w + delta, maxWidthFor(panelRef.current)));
  };

  return { width, max, onPointerDown, onKeyDown };
}
