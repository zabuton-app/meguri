import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import { usePlaybackQueue } from "@/hooks/usePlaybackQueue";
import type { FileRow } from "@/ipc/types";
import { sampleFileRow } from "@/test/fixtures";

function rows(from: number, to: number): FileRow[] {
  const out: FileRow[] = [];
  for (let id = from; id <= to; id++) {
    out.push({ ...sampleFileRow, id, relPath: `clip-${id}.mp4` });
  }
  return out;
}

function nav(items: FileRow[], overrides: Partial<MediaNav> = {}): MediaNav {
  return {
    items,
    listOffset: 0,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchPreviousPage: vi.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    ...overrides,
  };
}

/**
 * Mount the hook under a MediaNavProvider whose value can be swapped, the way
 * Home hands down a growing (or shrinking) list.
 */
function mount(initial: MediaNav) {
  let latest: ReturnType<typeof usePlaybackQueue>;

  function Probe() {
    latest = usePlaybackQueue({ shuffle: false, repeat: false });
    return null;
  }

  const tree = (value: MediaNav) => (
    <MediaNavProvider value={value}>
      <Probe />
    </MediaNavProvider>
  );

  const { rerender } = render(tree(initial));
  return {
    get result() {
      return latest;
    },
    setNav(value: MediaNav) {
      act(() => {
        rerender(tree(value));
      });
    },
  };
}

describe("usePlaybackQueue", () => {
  it("seeds from the list order it is given", () => {
    const q = mount(nav(rows(1, 3)));
    expect(q.result.current?.fileId).toBe(1);
    expect(q.result.total).toBe(3);
    expect(q.result.position).toBe(1);
  });

  it("walks the list one item at a time", () => {
    const q = mount(nav(rows(1, 3)));
    act(() => q.result.next());
    expect(q.result.current?.fileId).toBe(2);
    act(() => q.result.next());
    expect(q.result.current?.fileId).toBe(3);
    act(() => q.result.next());
    expect(q.result.current).toBeNull();
    expect(q.result.ended).toBe(true);
  });

  it("steps back to the previous item", () => {
    const q = mount(nav(rows(1, 3)));
    expect(q.result.canPrev).toBe(false);
    act(() => q.result.next());
    expect(q.result.canPrev).toBe(true);
    act(() => q.result.prev());
    expect(q.result.current?.fileId).toBe(1);
  });

  it("extends the queue when a later page arrives", () => {
    const q = mount(nav(rows(1, 2), { hasNextPage: true }));
    expect(q.result.total).toBe(2);
    q.setNav(nav(rows(1, 5), { hasNextPage: true }));
    expect(q.result.total).toBe(5);
    // Seeding happened once: playback did not restart at the head.
    expect(q.result.current?.fileId).toBe(1);
  });

  it("does not shrink when the list drops items that already played", () => {
    // Watch Later empties itself as items play; the queue must outlive that.
    const q = mount(nav(rows(1, 3)));
    act(() => q.result.next());
    q.setNav(nav(rows(2, 3)));
    expect(q.result.total).toBe(3);
    expect(q.result.current?.fileId).toBe(2);
  });

  it("asks for the next page before the queue runs dry", () => {
    const fetchNextPage = vi.fn();
    mount(nav(rows(1, 2), { hasNextPage: true, fetchNextPage }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("does not ask again while a page is already in flight", () => {
    const fetchNextPage = vi.fn();
    mount(
      nav(rows(1, 2), {
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage,
      }),
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("holds off on ending while more pages are still to come", () => {
    const q = mount(nav(rows(1, 1), { hasNextPage: true }));
    act(() => q.result.next());
    expect(q.result.ended).toBe(false);
    expect(q.result.waiting).toBe(true);
    // The next page resumes playback rather than leaving the player stranded.
    q.setNav(nav(rows(1, 2), { hasNextPage: false }));
    expect(q.result.current?.fileId).toBe(2);
    expect(q.result.waiting).toBe(false);
  });

  it("ends once the list is exhausted and nothing more is coming", () => {
    const q = mount(nav(rows(1, 1)));
    act(() => q.result.next());
    expect(q.result.ended).toBe(true);
    expect(q.result.unplayable).toBe(false);
  });

  it("flags a pass where every item had to be skipped", () => {
    const q = mount(nav(rows(1, 2)));
    act(() => q.result.skipCurrent());
    act(() => q.result.skipCurrent());
    expect(q.result.unplayable).toBe(true);
  });

  it("reports an empty list as ended with nothing in it", () => {
    const q = mount(nav([]));
    expect(q.result.current).toBeNull();
    expect(q.result.total).toBe(0);
    expect(q.result.ended).toBe(true);
  });
});
