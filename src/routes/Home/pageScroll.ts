// The list's page keys (PageDown / vim C-f / emacs C-v and their upward
// pairs): a press eases about a screen along, and a held key's repeats turn
// whole pages at a bounded rate.
import { LIST_MAIN_ID } from "./utils";

/** The list's scroll viewport, if Home is showing one. */
function listViewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#${LIST_MAIN_ID} [data-slot="scroll-area-viewport"]`,
  );
}

/** How far one page moves the view: a little under a screen, for context. */
function pageStep(vp: HTMLElement): number {
  return vp.clientHeight * 0.9;
}

/** `top` kept within the viewport's scroll range. */
function clampTop(vp: HTMLElement, top: number): number {
  return Math.min(vp.scrollHeight - vp.clientHeight, Math.max(0, top));
}

/**
 * The page scroll under way, animated here rather than by the browser's
 * smooth scrolling: a smooth scrollBy (or scrollTo) restarts its animation
 * from rest on every call, so quick presses crawled. This one moves toward a
 * target that later presses only push further on.
 */
interface PageScroll {
  viewport: HTMLElement;
  target: number;
  /**
   * scrollTop as this animation last left it; anything else moved it. Null
   * until the first frame: another scroll settling before then (the wheel's
   * own smooth scroll) must not cancel the press that started this one.
   */
  last: number | null;
}
let pageScroll: PageScroll | null = null;

/** Share of the remaining distance covered each frame (ease-out). */
const PAGE_SCROLL_EASE = 0.2;
/**
 * Most of the view one frame may move, so quick presses never move the list
 * further in a frame than the grid's two overscan rows cover (the rows for a
 * new position render a frame behind it).
 */
const PAGE_SCROLL_MAX_FRAME = 0.25;

function pageScrollFrame(run: PageScroll) {
  // Superseded (another list's viewport took over, or a held key's page
  // turn): this chain ends here.
  if (pageScroll !== run) return;
  const vp = run.viewport;
  // Another scroll took over (the wheel, a drag of the bar, a jump), or the
  // list went away: leave the view where that put it.
  if (
    !vp.isConnected ||
    (run.last !== null && Math.abs(vp.scrollTop - run.last) > 2)
  ) {
    pageScroll = null;
    return;
  }
  const remaining = run.target - vp.scrollTop;
  if (Math.abs(remaining) < 1) {
    vp.scrollTop = run.target;
    pageScroll = null;
    return;
  }
  const before = vp.scrollTop;
  const stride = Math.min(
    Math.abs(remaining) * PAGE_SCROLL_EASE,
    vp.clientHeight * PAGE_SCROLL_MAX_FRAME,
  );
  vp.scrollTop = before + Math.sign(remaining) * Math.max(1, stride);
  // Up against an end the list has not loaded past yet: stop there.
  if (vp.scrollTop === before) {
    pageScroll = null;
    return;
  }
  run.last = vp.scrollTop;
  requestAnimationFrame(() => pageScrollFrame(run));
}

/**
 * The page scroll under way on `vp`, unless something else has moved the
 * view since its last frame (it ends on its next one).
 */
function runOn(vp: HTMLElement): PageScroll | null {
  return pageScroll?.viewport === vp &&
    (pageScroll.last === null ||
      Math.abs(vp.scrollTop - pageScroll.last) <= 2)
    ? pageScroll
    : null;
}

/**
 * Ease the list ~one screen along (dir: 1 = down, -1 = up), for a press of a
 * page key.
 */
export function scrollListByPage(dir: number) {
  const vp = listViewport();
  if (!vp) return;
  const step = pageStep(vp);
  const current = vp.scrollTop;
  const run = runOn(vp);
  // Step on from where a scroll still under way is headed, so quick presses
  // add up; but never from more than a page past where the view is, so they
  // cannot queue up a long glide that runs on after the last one.
  const headed = run ? run.target : current;
  const from =
    dir > 0
      ? Math.min(Math.max(headed, current), current + step)
      : Math.max(Math.min(headed, current), current - step);
  const target = clampTop(vp, from + dir * step);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    pageScroll = null;
    vp.scrollTop = target;
    return;
  }
  if (run) {
    run.target = target;
    return;
  }
  const next: PageScroll = { viewport: vp, target, last: null };
  pageScroll = next;
  requestAnimationFrame(() => pageScrollFrame(next));
}

/**
 * Least time between two pages a held key turns: its repeats come ~30 times
 * a second, faster than the eye follows a page or the grid fills one in.
 * Slow enough for a modest machine to mount a page of cards and keep the
 * next page of results loading ahead, so the list pages on steadily.
 */
const PAGE_TURN_MS = 120;
/**
 * The last page a held key turned: when, and whether it has been painted.
 * Each turn gets a fresh object, so a turn's paint callback marks only its
 * own turn, never a later one.
 */
let pageTurn = { at: -Infinity, painted: true };

/**
 * Turn the list a whole page at once (dir: 1 = down, -1 = up), for a held
 * page key's repeat. At most one page per PAGE_TURN_MS, and only once the
 * last one is on screen; the repeats in between are dropped. Easing toward a
 * target the repeats pushed on left the view trailing the key, and gliding
 * on after it was let go.
 */
export function turnListPage(dir: number) {
  const vp = listViewport();
  if (!vp) return;
  const now = performance.now();
  if (!pageTurn.painted || now - pageTurn.at < PAGE_TURN_MS) return;
  // The press that started the hold may still be easing: turn on from where
  // it was headed (when that is this way), so no part of its page is lost.
  const run = runOn(vp);
  const current = vp.scrollTop;
  const from =
    run && Math.sign(run.target - current) === dir ? run.target : current;
  pageScroll = null;
  vp.scrollTop = clampTop(vp, from + dir * pageStep(vp));
  const turn = { at: now, painted: false };
  pageTurn = turn;
  // Two frames on, the frame with the new page has been painted.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      turn.painted = true;
    }),
  );
}

/** Forget any scroll under way and the last page turned (tests). */
export function resetPageScrollForTest() {
  pageScroll = null;
  pageTurn = { at: -Infinity, painted: true };
}
