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
    const signal = AbortSignal.timeout(5_000);
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return null;
      const release = await slots.acquire({ signal, maxWaiting: 32 });
      try {
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
