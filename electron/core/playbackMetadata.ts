import fs from "node:fs";
import { QueueFullError, Semaphore } from "./concurrency.js";
import { extractMeta } from "./media.js";

const slots = new Semaphore(2);
const pending = new Map<string, Promise<unknown>>();

/** Read stored metadata or share a bounded probe for a just-indexed clip. */
export async function probePlaybackMetadata(
  file: string,
  cached?: string | null,
): Promise<unknown> {
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (parsed != null) return parsed;
    } catch {
      // Fall back to probing if cached metadata is unreadable.
    }
  }
  const existing = pending.get(file);
  if (existing) return existing;
  const task = (async () => {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return null;
      // The wait is not timed: several requests share this probe, so it cannot
      // follow one client's disconnect, and the queue bound keeps it finite.
      // Timing it would turn a busy moment into missing track info (#382).
      const release = await slots.acquire({ maxWaiting: 32 });
      try {
        const signal = AbortSignal.timeout(5_000);
        return (await extractMeta(file, "video", signal)).raw;
      } finally {
        release();
      }
    } catch (e) {
      if (e instanceof QueueFullError) throw e;
      return null;
    } finally {
      pending.delete(file);
    }
  })();
  pending.set(file, task);
  return task;
}
