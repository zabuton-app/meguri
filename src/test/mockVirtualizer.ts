import { vi } from "vitest";

/** One spy for every instance, so a test can see what was scrolled to. */
const scrollToOffset = vi.hoisted(() => vi.fn());

export function mockVirtualizerScrollToOffset() {
  return scrollToOffset;
}

/** Render all virtual rows in jsdom (no layout engine / scroll viewport). */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const rowHeight = opts.estimateSize();
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          key: String(index),
          index,
          start: index * rowHeight,
        })),
      getTotalSize: () => opts.count * rowHeight,
      measureElement: () => {},
      measure: () => {},
      isScrolling: false,
      scrollToOffset,
      getOffsetForIndex: (index: number) => [index * rowHeight, "start"],
      // Keyboard focus navigation scrolls the focused row into view.
      scrollToIndex: vi.fn(),
    };
  },
}));
