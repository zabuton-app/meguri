// Playlist playback queue. Pure state + transitions, kept out of the player
// component so the ordering rules can be tested without a DOM.
//
// The queue is deliberately *not* a view of the list query. Items enter it from
// the list (see extend) but never leave when the list drops them: playing an
// item removes it from Watch Later, and a queue that followed the list would
// shrink from under the user mid-playback (spec FR-017).

/** One playable item. `kind` decides whether the player uses a timer or "ended". */
export interface QueueItem {
  workspaceId: string;
  fileId: number;
  kind: string;
}

/** Queue-internal item: carries the list position so unshuffling can restore it. */
interface SeqItem extends QueueItem {
  seq: number;
}

/** File IDs are unique only within a workspace, so the key needs both. */
export type QueueKey = string;

export function queueKey(item: {
  workspaceId: string;
  fileId: number;
}): QueueKey {
  return `${item.workspaceId}:${item.fileId}`;
}

export interface PlaybackQueue {
  /** Not yet played, in play order (shuffled when `shuffle` is on). */
  pool: SeqItem[];
  /** Already played, oldest first. "Previous" pops from the end. */
  history: SeqItem[];
  current: SeqItem | null;
  shuffle: boolean;
  repeat: boolean;
  /** Items that could not be played and were passed over. */
  skipped: SeqItem[];
  /** Every key ever admitted, so extend() never re-adds one. */
  seen: Set<QueueKey>;
  /** Next sequence number to hand out (the list order the items arrived in). */
  nextSeq: number;
  /** True once the queue ran out with repeat off. */
  ended: boolean;
}

export type Rng = () => number;

const defaultRng: Rng = Math.random;

/** Fisher–Yates. Returns a new array; the input is left alone. */
function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function bySeq(a: SeqItem, b: SeqItem): number {
  return a.seq - b.seq;
}

/** Re-derive the pool's order from the shuffle flag. */
function orderPool(pool: SeqItem[], shuffle: boolean, rng: Rng): SeqItem[] {
  return shuffle ? shuffled(pool, rng) : pool.slice().sort(bySeq);
}

export interface QueueOptions {
  shuffle?: boolean;
  repeat?: boolean;
  /** Start on this item instead of the first one. */
  startAt?: { workspaceId: string; fileId: number };
}

export function createQueue(
  items: readonly QueueItem[],
  options: QueueOptions = {},
  rng: Rng = defaultRng,
): PlaybackQueue {
  const shuffle = options.shuffle ?? false;
  const repeat = options.repeat ?? false;
  const seen = new Set<QueueKey>();
  const seq: SeqItem[] = [];
  for (const item of items) {
    const key = queueKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    seq.push({ ...item, seq: seq.length });
  }

  // An explicit start item leads; everything else follows in queue order. This
  // keeps "play from here" working without reordering the underlying list.
  let head: SeqItem | null = null;
  let rest = seq;
  if (options.startAt) {
    const wanted = queueKey(options.startAt);
    const at = seq.findIndex((it) => queueKey(it) === wanted);
    if (at >= 0) {
      head = seq[at];
      rest = seq.filter((_, i) => i !== at);
    }
  }
  const pool = orderPool(rest, shuffle, rng);
  const current = head ?? pool.shift() ?? null;

  return {
    pool,
    history: [],
    current,
    shuffle,
    repeat,
    skipped: [],
    seen,
    nextSeq: seq.length,
    ended: current == null,
  };
}

/** Move to the next item, retiring the current one into history. */
export function advance(
  q: PlaybackQueue,
  rng: Rng = defaultRng,
): PlaybackQueue {
  const history = q.current ? [...q.history, q.current] : q.history;
  return takeNext({ ...q, history }, rng);
}

/**
 * Pass over the current item without retiring it into history: it could not be
 * played, so "previous" should not walk back onto it either (spec FR-015).
 */
export function skip(q: PlaybackQueue, rng: Rng = defaultRng): PlaybackQueue {
  const skipped = q.current ? [...q.skipped, q.current] : q.skipped;
  return takeNext({ ...q, skipped }, rng);
}

function takeNext(q: PlaybackQueue, rng: Rng): PlaybackQueue {
  if (q.pool.length > 0) {
    const [next, ...pool] = q.pool;
    return { ...q, pool, current: next, ended: false };
  }
  // Exhausted. With repeat on, everything played this pass goes back in.
  if (q.repeat && q.history.length > 0) {
    const pool = orderPool(q.history, q.shuffle, rng);
    const [next, ...rest] = pool;
    return { ...q, pool: rest, history: [], current: next, ended: false };
  }
  return { ...q, current: null, ended: true };
}

/** Step back to the previously played item. No-op when nothing was played yet. */
export function back(q: PlaybackQueue): PlaybackQueue {
  if (q.history.length === 0) return q;
  const history = q.history.slice(0, -1);
  const prev = q.history[q.history.length - 1];
  const pool = q.current ? [q.current, ...q.pool] : q.pool;
  return { ...q, pool, history, current: prev, ended: false };
}

/**
 * Admit newly loaded list items. Only additions are applied — items the list no
 * longer returns stay in the queue (FR-017), and anything already seen this
 * session is never re-admitted, which is what keeps one pass duplicate-free.
 */
export function extend(
  q: PlaybackQueue,
  items: readonly QueueItem[],
  rng: Rng = defaultRng,
): PlaybackQueue {
  const seen = q.seen;
  const nextSeen = new Set(seen);
  const fresh: SeqItem[] = [];
  let nextSeq = q.nextSeq;
  for (const item of items) {
    const key = queueKey(item);
    // Checked against the running set, not the incoming one: a batch that
    // repeats a key would otherwise admit it twice and play it twice in a pass,
    // which is the very thing this dedupe exists to prevent.
    if (nextSeen.has(key)) continue;
    nextSeen.add(key);
    fresh.push({ ...item, seq: nextSeq++ });
  }
  if (fresh.length === 0) return q;

  const pool = orderPool([...q.pool, ...fresh], q.shuffle, rng);
  const next: PlaybackQueue = { ...q, pool, seen: nextSeen, nextSeq };

  // The queue ran dry before these arrived: pick playback back up (FR-018).
  if (!next.current) return takeNext(next, rng);
  return next;
}

/** Turn shuffling on/off. Only the unplayed pool is reordered; nothing is cut short. */
export function setShuffle(
  q: PlaybackQueue,
  shuffle: boolean,
  rng: Rng = defaultRng,
): PlaybackQueue {
  if (q.shuffle === shuffle) return q;
  return { ...q, shuffle, pool: orderPool(q.pool, shuffle, rng) };
}

export function setRepeat(q: PlaybackQueue, repeat: boolean): PlaybackQueue {
  return q.repeat === repeat ? q : { ...q, repeat };
}

/** Total items admitted so far (played + pending + skipped + current). */
export function queueSize(q: PlaybackQueue): number {
  return q.seen.size;
}

/** 1-based position of the current item among the admitted ones. */
export function queuePosition(q: PlaybackQueue): number {
  return q.history.length + q.skipped.length + (q.current ? 1 : 0);
}

/** True when playback finished without a single item having played. */
export function endedUnplayable(q: PlaybackQueue): boolean {
  return q.ended && q.history.length === 0 && q.skipped.length > 0;
}
