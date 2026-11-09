// The list's page keys (PageDown / vim C-f / emacs C-v): a press eases about
// a screen down, quick presses carry the scroll on rather than restart it,
// and a held key's repeats turn whole pages at a bounded rate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIST_MAIN_ID } from "@/routes/Home/utils";
import {
  resetPageScrollForTest,
  scrollListByPage,
  turnListPage,
} from "@/routes/Home/pageScroll";

const VIEW_H = 500;
const CONTENT_H = 20_000;
const STEP = VIEW_H * 0.9;

let viewport: HTMLElement;
let reducedMotion = false;

/**
 * A list viewport with a real scroll range (jsdom has no layout). `round`
 * snaps scrollTop to whole pixels as a browser may.
 */
function mountViewport(
  { viewH = VIEW_H, round = false }: { viewH?: number; round?: boolean } = {},
  writes?: number[],
): HTMLElement {
  const main = document.createElement("main");
  main.id = LIST_MAIN_ID;
  const vp = document.createElement("div");
  vp.dataset.slot = "scroll-area-viewport";
  let top = 0;
  Object.defineProperties(vp, {
    clientHeight: { get: () => viewH },
    scrollHeight: { get: () => CONTENT_H },
    scrollTop: {
      get: () => top,
      set: (v: number) => {
        writes?.push(v);
        const clamped = Math.min(CONTENT_H - viewH, Math.max(0, v));
        top = round ? Math.round(clamped) : clamped;
      },
    },
  });
  main.appendChild(vp);
  document.body.appendChild(main);
  return vp;
}

/** Run animation frames until the scroll settles (or `max` frames pass). */
function frames(n: number) {
  for (let i = 0; i < n; i++) vi.advanceTimersToNextFrame();
}

beforeEach(() => {
  // The module keeps the scroll under way and the last page turned, timed on
  // a fake clock that restarts every test.
  resetPageScrollForTest();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reducedMotion && query.includes("reduce"),
      }) as MediaQueryList,
  );
  viewport = mountViewport();
});

afterEach(() => {
  // Let any frame left pending run out before the clock is restored.
  frames(10);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("page keys", () => {
  it("eases one press down to about a screen", () => {
    scrollListByPage(1);
    frames(1);
    const early = viewport.scrollTop;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(STEP);
    frames(100);
    expect(viewport.scrollTop).toBe(STEP);
  });

  it("carries quick presses on instead of restarting from rest", () => {
    // 30 presses, two frames apart.
    for (let i = 0; i < 30; i++) {
      scrollListByPage(1);
      frames(2);
    }
    // Restarting from rest every press used to leave this well under a screen.
    expect(viewport.scrollTop).toBeGreaterThan(STEP * 10);
  });

  it("stops soon after the last of quick presses", () => {
    for (let i = 0; i < 30; i++) {
      scrollListByPage(1);
      frames(2);
    }
    const atRelease = viewport.scrollTop;
    frames(200);
    // At most the two pages a held key may run ahead.
    expect(viewport.scrollTop - atRelease).toBeLessThanOrEqual(STEP * 2);
  });

  it("goes back up a page the same way", () => {
    viewport.scrollTop = 5000;
    scrollListByPage(-1);
    frames(100);
    expect(viewport.scrollTop).toBe(5000 - STEP);
  });

  it("gives the view up to another scroll that moves it meanwhile", () => {
    scrollListByPage(1);
    frames(2);
    viewport.scrollTop = 3000; // the wheel, say
    frames(100);
    expect(viewport.scrollTop).toBe(3000);
  });

  it("stops at the end of what is loaded", () => {
    viewport.scrollTop = CONTENT_H - VIEW_H - 100;
    scrollListByPage(1);
    frames(100);
    expect(viewport.scrollTop).toBe(CONTENT_H - VIEW_H);
  });

  it("jumps without animating when motion is reduced", () => {
    reducedMotion = true;
    scrollListByPage(1);
    expect(viewport.scrollTop).toBe(STEP);
  });

  it("settles on a whole pixel when the browser rounds the position", () => {
    document.body.innerHTML = "";
    const writes: number[] = [];
    viewport = mountViewport({ viewH: 517, round: true }, writes);
    scrollListByPage(1);
    frames(200);
    expect(viewport.scrollTop).toBe(Math.round(517 * 0.9));
    // Finished: no frame keeps nudging it.
    const settled = writes.length;
    frames(20);
    expect(writes).toHaveLength(settled);
  });

  it("moves no more than a quarter of the view in one frame", () => {
    const tops = [viewport.scrollTop];
    for (let i = 0; i < 30; i++) {
      scrollListByPage(1);
      frames(1);
      tops.push(viewport.scrollTop);
      frames(1);
      tops.push(viewport.scrollTop);
    }
    const strides = tops.slice(1).map((t, i) => t - tops[i]);
    expect(Math.max(...strides)).toBeLessThanOrEqual(VIEW_H * 0.25 + 1e-6);
  });

  it("turns straight back when the other page key is pressed", () => {
    viewport.scrollTop = 5000;
    scrollListByPage(1);
    frames(3);
    const turnedAt = viewport.scrollTop;
    scrollListByPage(-1);
    frames(100);
    expect(viewport.scrollTop).toBeCloseTo(turnedAt - STEP, 0);
  });

  it("drives a new viewport at one step a frame after the old one is swapped out", () => {
    scrollListByPage(1);
    frames(2);
    // Another view mounts its own viewport while the old animation runs.
    document.body.innerHTML = "";
    const writes: number[] = [];
    viewport = mountViewport({}, writes);
    // Presses keep coming after the swap.
    for (let i = 0; i < 5; i++) {
      scrollListByPage(1);
      frames(1);
    }
    expect(writes).toHaveLength(5);
  });

  it("stops when the list goes away", () => {
    scrollListByPage(1);
    frames(2);
    const old = viewport;
    const at = old.scrollTop;
    old.parentElement?.remove();
    frames(20);
    expect(old.scrollTop).toBe(at);
  });

  it("keeps a press made while another scroll settles", () => {
    // The wheel moves the view after the press but before its first frame.
    scrollListByPage(1);
    viewport.scrollTop = 300;
    frames(100);
    expect(viewport.scrollTop).toBeGreaterThan(300);
  });

  describe("a held key's repeats", () => {
    /** Hold: an initial press, then `n` repeats two frames (~33ms) apart. */
    function hold(n: number, dir = 1) {
      scrollListByPage(dir);
      frames(30); // the OS waits before it starts repeating
      for (let i = 0; i < n; i++) {
        turnListPage(dir);
        frames(2);
      }
    }

    it("turn a whole page at once, without easing", () => {
      hold(0);
      const before = viewport.scrollTop;
      turnListPage(1);
      expect(viewport.scrollTop).toBe(before + STEP);
    });

    it("turn at most one page per interval", () => {
      hold(0);
      const start = viewport.scrollTop;
      // 30 repeats over ~1s: ~8 pages at one per 120ms, not 30.
      for (let i = 0; i < 30; i++) {
        turnListPage(1);
        frames(2);
      }
      const pages = Math.round((viewport.scrollTop - start) / STEP);
      expect(pages).toBeGreaterThanOrEqual(6);
      expect(pages).toBeLessThanOrEqual(10);
    });

    it("stop the moment the key is released", () => {
      hold(20);
      const atRelease = viewport.scrollTop;
      frames(100);
      expect(viewport.scrollTop).toBe(atRelease);
    });

    it("wait for the last page to be painted", () => {
      hold(0);
      turnListPage(1);
      const turned = viewport.scrollTop;
      // Plenty of time, but only one frame has run since (a busy renderer):
      // the frame with the new page is not yet known to be painted.
      const later = performance.now() + 500;
      vi.spyOn(performance, "now").mockReturnValue(later);
      frames(1);
      turnListPage(1);
      expect(viewport.scrollTop).toBe(turned);
      // A second frame paints it; the next repeat turns on.
      frames(1);
      turnListPage(1);
      expect(viewport.scrollTop).toBe(turned + STEP);
    });

    it("take over from a press still easing, keeping its page", () => {
      scrollListByPage(1);
      frames(2);
      expect(viewport.scrollTop).toBeLessThan(STEP);
      turnListPage(1);
      frames(100);
      expect(viewport.scrollTop).toBe(STEP * 2);
    });

    it("go up the same way and stop at the top", () => {
      viewport.scrollTop = STEP * 2.5;
      hold(20, -1);
      expect(viewport.scrollTop).toBe(0);
    });
  });
});
