import { vi } from "vitest";

/** Render all virtual rows in jsdom (no layout engine / scroll viewport).
 *  Mirrors the real virtualizer's scrollMargin semantics: item starts include
 *  it, the total size does not. */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: () => number;
    scrollMargin?: number;
  }) => {
    const rowHeight = opts.estimateSize();
    const margin = opts.scrollMargin ?? 0;
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          key: String(index),
          index,
          start: margin + index * rowHeight,
        })),
      getTotalSize: () => opts.count * rowHeight,
      measureElement: () => {},
      measure: () => {},
      scrollToOffset: vi.fn(),
      // Keyboard focus navigation scrolls the focused row into view.
      scrollToIndex: vi.fn(),
    };
  },
}));
