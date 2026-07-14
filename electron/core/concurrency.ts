/** Counting semaphore. `acquire()` resolves with a `release()` callback. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (limit < 1) throw new Error("Semaphore limit must be >= 1");
    this.available = limit;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.available > 0) {
        this.available--;
        resolve(() => this.release());
      } else {
        this.waiters.push(() => resolve(() => this.release()));
      }
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
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
