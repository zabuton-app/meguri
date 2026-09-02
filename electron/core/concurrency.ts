import { setTimeout as sleep } from "node:timers/promises";

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("This operation was aborted", "AbortError");
}

/** Thrown by `acquire()` when the wait queue is at its caller-given bound. */
export class QueueFullError extends Error {
  constructor(waiting: number) {
    super(`semaphore queue full (${waiting} waiting)`);
    this.name = "QueueFullError";
  }
}

export interface AcquireOptions {
  /** Abort while queued: the waiter is removed and the promise rejects with
   *  the signal's reason (an AbortError by default). */
  signal?: AbortSignal;
  /** Reject with QueueFullError instead of queueing when this many are
   *  already waiting. Lets request handlers shed load instead of piling up. */
  maxWaiting?: number;
}

/** Counting semaphore. `acquire()` resolves with a `release()` callback. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<{ grant: () => void }> = [];

  /** Number of callers currently queued for a permit. */
  get waiting(): number {
    return this.waiters.length;
  }

  constructor(limit: number) {
    if (limit < 1) throw new Error("Semaphore limit must be >= 1");
    this.available = limit;
  }

  /** Wait for a permit (see AcquireOptions for cancellation and load shedding). */
  acquire({ signal, maxWaiting }: AcquireOptions = {}): Promise<() => void> {
    // Each grant's release() is one-shot: callers wired to several terminal
    // events (child "error" + "close") must not be able to inflate the pool.
    const grant = (): (() => void) => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.release();
      };
    };
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      if (this.available > 0) {
        this.available--;
        resolve(grant());
        return;
      }
      if (maxWaiting !== undefined && this.waiters.length >= maxWaiting) {
        reject(new QueueFullError(this.waiters.length));
        return;
      }
      const waiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(grant());
        },
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        if (signal) reject(abortReason(signal));
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next.grant();
    else this.available++;
  }
}

/**
 * Resolve with `promise`'s result, or with `undefined` once `ms` elapse —
 * whichever comes first. The timer never keeps the process alive, which is
 * what makes this safe on shutdown paths.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  return Promise.race([promise, sleep(ms, undefined, { ref: false })]);
}

/**
 * Process `items` with up to `limit` workers in parallel. If `signal` aborts,
 * idle workers stop picking up new items (in-flight calls run to completion).
 */
export async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (i < items.length && !signal?.aborted) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
