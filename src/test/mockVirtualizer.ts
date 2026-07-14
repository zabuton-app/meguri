import { vi } from "vitest";

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
      scrollToOffset: vi.fn(),
    };
  },
}));
