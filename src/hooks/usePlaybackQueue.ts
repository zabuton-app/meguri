// Drives the playlist queue from the list the user is browsing.
//
// The list order arrives through MediaNavContext — the same context the detail
// modal uses for prev/next — so the player inherits whatever sort and filter the
// list has, works from any list (not just collections), and keeps growing past
// the loaded tail as more pages arrive.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaNav } from "@/components/MediaNavContext";
import {
  advance,
  back,
  createQueue,
  endedUnplayable,
  extend,
  queuePosition,
  queueSize,
  setRepeat as setQueueRepeat,
  setShuffle as setQueueShuffle,
  skip,
  type PlaybackQueue,
  type QueueItem,
} from "@/lib/playbackQueue";

/** How few unplayed items may be left before the next page is requested. */
const PREFETCH_THRESHOLD = 3;

export interface UsePlaybackQueueOptions {
  shuffle: boolean;
  repeat: boolean;
  /** Start on this item instead of the head of the list. */
  startAt?: { workspaceId: string; fileId: number };
  /**
   * Pick a previous queue back up instead of building a new one. Used when the
   * player comes back from the detail view: seeding afresh would restart the
   * pass, losing the history, the shuffled order and the progress count.
   */
  restore?: PlaybackQueue;
}

export interface UsePlaybackQueueResult {
  current: QueueItem | null;
  /** The item that would play next, without advancing to it. */
  upcoming: QueueItem | null;
  /** True once playback is finished and no further pages can extend it. */
  ended: boolean;
  /** True when the pass finished without a single item having played. */
  unplayable: boolean;
  /** True while the queue is empty but pages are still loading. */
  waiting: boolean;
  position: number;
  total: number;
  next: () => void;
  prev: () => void;
  skipCurrent: () => void;
  canPrev: boolean;
  /** The queue itself, so a caller can put it aside and restore it later. */
  queue: PlaybackQueue;
}

function toQueueItems(
  rows: readonly { id: number; workspaceId: string; kind: string }[],
): QueueItem[] {
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    fileId: row.id,
    kind: row.kind,
  }));
}

export function usePlaybackQueue(
  options: UsePlaybackQueueOptions,
): UsePlaybackQueueResult {
  const nav = useMediaNav();
  const navItems = useMemo(() => nav?.items ?? [], [nav?.items]);
  const items = useMemo(() => toQueueItems(navItems), [navItems]);

  // The queue is seeded once and then only ever extended. Re-seeding on list
  // changes would restart playback every time a page loads.
  const seeded = useRef(false);
  const [queue, setQueue] = useState<PlaybackQueue>(() =>
    createQueue([], { shuffle: options.shuffle, repeat: options.repeat }),
  );

  const { shuffle, repeat, startAt, restore } = options;
  // Read through refs so seeding uses the current start item without making the
  // seeding effect re-run when the caller passes a fresh object literal.
  const startAtRef = useRef(startAt);
  const restoreRef = useRef(restore);
  useEffect(() => {
    startAtRef.current = startAt;
    restoreRef.current = restore;
  });

  // One effect owns the queue's reaction to the outside world: newly loaded list
  // items and preference changes made while the player is open. The updaters are
  // all no-ops when nothing actually changed, so this settles in one pass.
  useEffect(() => {
    if (!seeded.current) {
      const previous = restoreRef.current;
      if (previous) {
        // A restored queue stands on its own: it already holds every item it
        // ever admitted, so unlike a fresh seed it does not have to wait for
        // the list to load before playback can carry on. What arrives from the
        // list is only ever appended, so the caller has to be sure it is the
        // same list the queue came from — the player checks that by naming the
        // parked file in the URL before it hands one back.
        seeded.current = true;
        setQueue(
          setQueueRepeat(
            setQueueShuffle(extend(previous, items), shuffle),
            repeat,
          ),
        );
        return;
      }
      if (items.length === 0) return;
      seeded.current = true;
      setQueue(
        createQueue(items, { shuffle, repeat, startAt: startAtRef.current }),
      );
      return;
    }
    setQueue((q) =>
      setQueueRepeat(setQueueShuffle(extend(q, items), shuffle), repeat),
    );
  }, [items, shuffle, repeat]);

  // Pull the next page in before the queue runs dry, so playback never stalls
  // at the tail of what happens to be loaded.
  useEffect(() => {
    if (!nav?.hasNextPage || nav.isFetchingNextPage) return;
    if (queue.pool.length > PREFETCH_THRESHOLD) return;
    nav.fetchNextPage();
  }, [queue.pool.length, nav]);

  const next = useCallback(() => setQueue((q) => advance(q)), []);
  const prev = useCallback(() => setQueue((q) => back(q)), []);
  const skipCurrent = useCallback(() => setQueue((q) => skip(q)), []);

  const morePending = nav?.hasNextPage ?? false;
  return {
    current: queue.current,
    upcoming: queue.pool[0] ?? null,
    ended: queue.ended && !morePending,
    unplayable: endedUnplayable(queue) && !morePending,
    waiting: queue.current == null && morePending,
    position: queuePosition(queue),
    total: queueSize(queue),
    next,
    prev,
    skipCurrent,
    canPrev: queue.history.length > 0,
    queue,
  };
}
