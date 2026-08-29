import { describe, expect, it } from "vitest";
import {
  advance,
  back,
  createQueue,
  endedUnplayable,
  extend,
  queueKey,
  queuePosition,
  queueSize,
  setRepeat,
  setShuffle,
  skip,
  type PlaybackQueue,
  type QueueItem,
  type Rng,
} from "@/lib/playbackQueue";

function items(n: number, workspaceId = "ws1"): QueueItem[] {
  return Array.from({ length: n }, (_, i) => ({
    workspaceId,
    fileId: i + 1,
    kind: i % 2 === 0 ? "video" : "image",
  }));
}

/** Deterministic rng cycling through the given values (looped). */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Reverses any array under Fisher-Yates: always swap with index 0. */
const reverseRng: Rng = () => 0;

/** Every key that is currently anywhere in the queue. */
function liveKeys(q: PlaybackQueue): string[] {
  return [
    ...q.history.map(queueKey),
    ...(q.current ? [queueKey(q.current)] : []),
    ...q.pool.map(queueKey),
    ...q.skipped.map(queueKey),
  ];
}

/** Play the queue to the end, collecting the keys in the order they played. */
function playThrough(q: PlaybackQueue, rng?: Rng): string[] {
  const played: string[] = [];
  let cur = q;
  let guard = 0;
  while (cur.current && guard++ < 1000) {
    played.push(queueKey(cur.current));
    cur = advance(cur, rng);
  }
  return played;
}

describe("createQueue", () => {
  it("starts on the first item and queues the rest in list order", () => {
    const q = createQueue(items(3));
    expect(queueKey(q.current!)).toBe("ws1:1");
    expect(q.pool.map(queueKey)).toEqual(["ws1:2", "ws1:3"]);
    expect(q.ended).toBe(false);
  });

  it("ends immediately when there is nothing to play", () => {
    const q = createQueue([]);
    expect(q.current).toBeNull();
    expect(q.ended).toBe(true);
  });

  it("drops duplicate items so a pass can never repeat one", () => {
    const dup = [...items(2), { workspaceId: "ws1", fileId: 1, kind: "video" }];
    const q = createQueue(dup);
    expect(queueSize(q)).toBe(2);
  });

  it("can start on a specific item without reordering the rest", () => {
    const q = createQueue(items(4), {
      startAt: { workspaceId: "ws1", fileId: 3 },
    });
    expect(playThrough(q)).toEqual(["ws1:3", "ws1:1", "ws1:2", "ws1:4"]);
  });

  it("keys items by workspace so ids from different workspaces never collide", () => {
    const q = createQueue([...items(1, "wsA"), ...items(1, "wsB")]);
    expect(queueSize(q)).toBe(2);
    expect(playThrough(q)).toEqual(["wsA:1", "wsB:1"]);
  });
});

describe("advance", () => {
  it("walks the whole queue exactly once, then ends", () => {
    const q = createQueue(items(4));
    expect(playThrough(q)).toEqual(["ws1:1", "ws1:2", "ws1:3", "ws1:4"]);
  });

  it("retires the played item into history", () => {
    const q = advance(advance(createQueue(items(3))));
    expect(q.history.map(queueKey)).toEqual(["ws1:1", "ws1:2"]);
    expect(queueKey(q.current!)).toBe("ws1:3");
  });

  it("marks the queue ended once the pool runs dry with repeat off", () => {
    let q = createQueue(items(1));
    q = advance(q);
    expect(q.current).toBeNull();
    expect(q.ended).toBe(true);
  });

  it("loops back through the played items when repeat is on", () => {
    let q = setRepeat(createQueue(items(2)), true);
    q = advance(advance(q));
    expect(q.ended).toBe(false);
    expect(queueKey(q.current!)).toBe("ws1:1");
  });
});

describe("back", () => {
  it("returns to the previously played item and re-queues the current one", () => {
    let q = createQueue(items(3));
    q = advance(advance(q));
    q = back(q);
    expect(queueKey(q.current!)).toBe("ws1:2");
    expect(q.pool.map(queueKey)).toEqual(["ws1:3"]);
    expect(q.history.map(queueKey)).toEqual(["ws1:1"]);
  });

  it("is a no-op at the very start", () => {
    const q = createQueue(items(3));
    expect(back(q)).toBe(q);
  });

  it("does not re-roll the shuffle: back then forward lands on the same item", () => {
    let q = createQueue(
      items(6),
      { shuffle: true },
      seqRng([0.7, 0.2, 0.9, 0.1]),
    );
    q = advance(q, reverseRng);
    const wasNext = queueKey(q.current!);
    q = back(q);
    q = advance(q, reverseRng);
    expect(queueKey(q.current!)).toBe(wasNext);
  });

  it("never walks back onto an item that was skipped", () => {
    let q = createQueue(items(3));
    q = skip(q);
    q = back(q);
    // Nothing has actually played, so there is nowhere to go back to.
    expect(queueKey(q.current!)).toBe("ws1:2");
  });
});

describe("skip", () => {
  it("passes over the item and keeps playing", () => {
    let q = createQueue(items(3));
    q = skip(q);
    expect(queueKey(q.current!)).toBe("ws1:2");
    expect(q.skipped.map(queueKey)).toEqual(["ws1:1"]);
    expect(q.history).toHaveLength(0);
  });

  it("reports an all-unplayable pass distinctly from a normal finish", () => {
    let q = createQueue(items(2));
    q = skip(skip(q));
    expect(q.ended).toBe(true);
    expect(endedUnplayable(q)).toBe(true);
  });

  it("does not report unplayable when at least one item played", () => {
    let q = createQueue(items(2));
    q = advance(q);
    q = skip(q);
    expect(endedUnplayable(q)).toBe(false);
  });
});

describe("extend", () => {
  it("appends newly loaded items without touching what is already queued", () => {
    let q = createQueue(items(2));
    q = advance(q);
    q = extend(q, [
      ...items(2),
      { workspaceId: "ws1", fileId: 3, kind: "video" },
    ]);
    expect(q.pool.map(queueKey)).toEqual(["ws1:3"]);
    expect(q.history.map(queueKey)).toEqual(["ws1:1"]);
  });

  it("ignores items already seen, so a pass stays duplicate-free", () => {
    let q = createQueue(items(3));
    q = advance(advance(advance(q)));
    q = extend(q, items(3));
    expect(q.current).toBeNull();
    expect(queueSize(q)).toBe(3);
  });

  it("does not shrink when the list drops items that are already queued", () => {
    // Watch Later empties itself as items play; the queue must not follow.
    let q = createQueue(items(3));
    q = advance(q);
    const before = liveKeys(q);
    q = extend(q, []);
    expect(liveKeys(q)).toEqual(before);
  });

  it("resumes a queue that ran dry before the next page arrived", () => {
    let q = createQueue(items(1));
    q = advance(q);
    expect(q.ended).toBe(true);
    q = extend(q, [{ workspaceId: "ws1", fileId: 2, kind: "image" }]);
    expect(q.ended).toBe(false);
    expect(queueKey(q.current!)).toBe("ws1:2");
  });

  it("returns the same object when there is nothing new", () => {
    const q = createQueue(items(2));
    expect(extend(q, items(2))).toBe(q);
  });
});

describe("shuffle", () => {
  it("plays every item exactly once across a shuffled pass", () => {
    const q = createQueue(
      items(10),
      { shuffle: true },
      seqRng([0.31, 0.87, 0.05, 0.64, 0.42]),
    );
    const played = playThrough(q, seqRng([0.31, 0.87, 0.05, 0.64, 0.42]));
    expect(played).toHaveLength(10);
    expect(new Set(played).size).toBe(10);
  });

  it("produces an order different from the list order", () => {
    const q = createQueue(items(10), { shuffle: true }, reverseRng);
    const played = playThrough(q, reverseRng);
    const listOrder = items(10).map(queueKey);
    expect(played).not.toEqual(listOrder);
  });

  it("only reorders unplayed items when toggled on mid-playback", () => {
    let q = createQueue(items(5));
    q = advance(advance(q));
    const playedBefore = q.history.map(queueKey);
    const currentBefore = queueKey(q.current!);
    q = setShuffle(q, true, reverseRng);
    expect(q.history.map(queueKey)).toEqual(playedBefore);
    expect(queueKey(q.current!)).toBe(currentBefore);
    expect(new Set(q.pool.map(queueKey))).toEqual(new Set(["ws1:4", "ws1:5"]));
  });

  it("restores the list order when switched back off", () => {
    let q = createQueue(items(5), { shuffle: true }, reverseRng);
    q = setShuffle(q, false);
    expect(q.pool.map(queueKey)).toEqual(
      q.pool
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map(queueKey),
    );
  });

  it("mixes newly loaded items into the remaining pool while shuffled", () => {
    let q = createQueue(items(3), { shuffle: true }, reverseRng);
    q = extend(
      q,
      [{ workspaceId: "ws1", fileId: 9, kind: "image" }],
      reverseRng,
    );
    expect(q.pool.map(queueKey)).toContain("ws1:9");
    expect(new Set(liveKeys(q)).size).toBe(liveKeys(q).length);
  });

  it("keeps a repeated shuffled pass duplicate-free", () => {
    let q = setRepeat(
      createQueue(items(4), { shuffle: true }, reverseRng),
      true,
    );
    const first: string[] = [];
    for (let i = 0; i < 4; i++) {
      first.push(queueKey(q.current!));
      q = advance(q, reverseRng);
    }
    expect(new Set(first).size).toBe(4);
    const second: string[] = [];
    for (let i = 0; i < 4; i++) {
      second.push(queueKey(q.current!));
      q = advance(q, reverseRng);
    }
    expect(new Set(second).size).toBe(4);
  });
});

describe("progress", () => {
  it("counts the current item as the 1-based position", () => {
    let q = createQueue(items(3));
    expect(queuePosition(q)).toBe(1);
    q = advance(q);
    expect(queuePosition(q)).toBe(2);
    expect(queueSize(q)).toBe(3);
  });
});
