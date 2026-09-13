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
/** Marks the element the inset is written on: the one wrapping the overlays
 *  that read it (Home's FABs). Writing it on <html> instead would mark the
 *  whole document for style recalculation on every frame of a drag — measured
 *  at ~5ms per write with a 3,400-node grid, against ~0.1ms scoped. */
export const PEEK_INSET_DOCK_PROPS = { "data-peek-inset-dock": "" } as const;

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
  // The dock when Home has one, else <html> (which also carries the 0px
  // default in styles.css that the dock falls back to when cleared).
  const host =
    document.querySelector<HTMLElement>("[data-peek-inset-dock]") ??
    document.documentElement;
  const next = `${px}px`;
  // Rewriting a custom property invalidates styles that depend on it, so
  // only touch it when the value moved (a drag calls this every frame).
  if (host.style.getPropertyValue(PEEK_INSET_VAR) === next) return;
  host.style.setProperty(PEEK_INSET_VAR, next);
}

interface Drag {
  pointerId: number;
  /** End the drag, committing the width reached. */
  finish: () => void;
  /** Apply a new ceiling to the width in progress (the panel, the inset
   *  and the handle's value follow). */
  clampTo: (max: number) => void;
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
  // The current ceiling: measured on docking and on window resize (the only
  // times it can move), and read from here by the key handler so a key
  // repeat never has to read layout.
  const [max, setMax] = useState(Infinity);
  // The same ceiling for a drag in progress, which must follow a window
  // resized mid-drag rather than the ceiling measured when it started.
  const maxRef = useRef(Infinity);
  // Mirrors `width` for the paths that must not write when nothing moved:
  // useLocalStorage persists on every set, and a resize being dragged or a
  // key held at a limit would otherwise write to storage every frame.
  const widthRef = useRef(width);
  useLayoutEffect(() => {
    widthRef.current = width;
  }, [width]);

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
      maxRef.current = m;
      // Mid-drag the live width is the DOM's, not the state's: clamp that
      // one and leave the state alone, so the re-render for `max` does not
      // write a stale width over the drag (React rewrites the style only
      // when the state value changes).
      if (dragRef.current) {
        dragRef.current.clampTo(m);
        return;
      }
      const fitted = clamp(widthRef.current, m);
      if (fitted !== widthRef.current) setWidth(fitted);
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
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => () => dragRef.current?.finish(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (e.button !== 0 || !panel || dragRef.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    // preventDefault above keeps the click from focusing the handle; do it
    // here so Arrow keys refine the width right after grabbing it.
    handle.focus();
    const { pointerId } = e;
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    let next = clamp(startWidth, maxRef.current);
    let moved = false;
    // Live: the DOM and the inset move with the pointer, React state only
    // when the drag ends, so the frame (and the player inside it) is not
    // re-rendered per pointer move.
    const apply = (width: number) => {
      next = width;
      panel.style.width = `${next}px`;
      handle.setAttribute("aria-valuenow", String(next));
      publishInset(next);
    };
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      moved = true;
      // The edge moves left to grow: pointer travel is subtracted.
      apply(clamp(startWidth + (startX - ev.clientX), maxRef.current));
    };
    const clampTo = (m: number) => {
      const clamped = clamp(next, m);
      if (clamped === next) return;
      // A ceiling that moved under the drag counts as movement: the width
      // it forced is the one to keep.
      moved = true;
      apply(clamped);
    };
    const finish = () => {
      if (dragRef.current?.pointerId !== pointerId) return;
      dragRef.current = null;
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
    // The compiler lint reads the fit effect's `dragRef.current.clampTo()`
    // call as this ref being mutated during render; it is an event handler
    // writing a ref that only effects and handlers read.
    // eslint-disable-next-line react-hooks/immutability
    dragRef.current = { pointerId, finish, clampTo };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Left grows the sheet (its edge moves left), right shrinks it.
    const delta =
      e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    // The player and the image viewer listen for the arrow keys on window
    // (seek, previous/next); a key spent on the handle must not reach them.
    e.stopPropagation();
    const next = clamp(widthRef.current + delta, max);
    if (next !== widthRef.current) setWidth(next);
  };

  return { width, max, onPointerDown, onKeyDown };
}
