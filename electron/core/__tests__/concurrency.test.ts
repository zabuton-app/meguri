// Regression tests for the shared worker-pool helper used by scan + jobs.
import { describe, expect, it } from "vitest";
import {
  pool,
  QueueFullError,
  Semaphore,
  withTimeout,
} from "../concurrency.js";

describe("Semaphore", () => {
  it("rejects a limit below 1", () => {
    expect(() => new Semaphore(0)).toThrow(/limit must be >= 1/);
  });

  it("limits concurrent holders", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const hold = async () => {
      const release = await sem.acquire();
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      release();
    };
    await Promise.all(Array.from({ length: 8 }, () => hold()));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("release is idempotent (a double release cannot inflate the pool)", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release();
    const release2 = await sem.acquire();
    let third = false;
    const pending = sem.acquire().then((r) => {
      third = true;
      r();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(third).toBe(false); // still only one permit
    release2();
    await pending;
    expect(third).toBe(true);
  });
});

describe("Semaphore.acquire(signal)", () => {
  it("rejects a queued waiter on abort and leaves the queue intact", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const ctrl = new AbortController();
    const aborted = sem.acquire({ signal: ctrl.signal });
    const later = sem.acquire();
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    release();
    const r = await later; // the un-aborted waiter still gets the permit
    r();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const sem = new Semaphore(1);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(sem.acquire({ signal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    (await sem.acquire())(); // permit was not consumed
  });
});

describe("Semaphore.acquire({ maxWaiting })", () => {
  it("sheds load once the queue is at the bound", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const queued = sem.acquire({ maxWaiting: 1 }); // 0 waiting → queues
    await expect(sem.acquire({ maxWaiting: 1 })).rejects.toBeInstanceOf(
      QueueFullError,
    );
    expect(sem.waiting).toBe(1);
    release();
    (await queued)();
  });
});

describe("withTimeout", () => {
  it("returns the value when the promise settles first", async () => {
    expect(await withTimeout(Promise.resolve(7), 1000)).toBe(7);
  });
  it("returns undefined once the timeout elapses", async () => {
    expect(
      await withTimeout(new Promise<number>(() => {}), 10),
    ).toBeUndefined();
  });
});

describe("pool", () => {
  it("returns immediately when items is empty", async () => {
    let calls = 0;
    await pool<number>([], 4, () => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(0);
  });

  it("processes every item when limit exceeds item count", async () => {
    const items = [1, 2, 3];
    const seen: number[] = [];
    await pool(items, 8, (n) => {
      seen.push(n);
      return Promise.resolve();
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await pool(items, 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("stops picking up new items once signal aborts but lets in-flight work finish", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const finished: number[] = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    await pool(
      items,
      4,
      async (n) => {
        started.push(n);
        if (n === 3) controller.abort();
        await new Promise((r) => setTimeout(r, 1));
        finished.push(n);
      },
      controller.signal,
    );
    // Every started item must have completed (in-flight runs to completion).
    expect(finished.sort((a, b) => a - b)).toEqual(
      started.sort((a, b) => a - b),
    );
    // After abort, workers stop picking up new items, so not all 20 are processed.
    expect(started.length).toBeLessThan(items.length);
  });
});
