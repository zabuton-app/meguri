import fs from "node:fs";
import { QueueFullError, Semaphore } from "./concurrency.js";
import { extractMeta } from "./media.js";

const slots = new Semaphore(2);
const pending = new Map<string, Promise<unknown>>();

// A player sends several range requests per file and more on every seek, so a
// clip without stored metadata would be probed on each one (#683). A failure
// is kept too: a file ffprobe cannot read fails the same way next time.
const REMEMBERED_MAX = 256;
const remembered = new Map<
  string,
  { size: number; mtimeMs: number; meta: unknown }
>();

function remember(file: string, stat: fs.Stats, meta: unknown): void {
  remembered.delete(file);
  remembered.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, meta });
  if (remembered.size > REMEMBERED_MAX) {
    remembered.delete(remembered.keys().next().value!);
  }
}

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
      const known = remembered.get(file);
      if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
        return known.meta;
      }
      // The wait is not timed: several requests share this probe, so it cannot
      // follow one client's disconnect, and the queue bound keeps it finite.
      // Timing it would turn a busy moment into missing track info (#382).
      const release = await slots.acquire({ maxWaiting: 32 });
      try {
        const signal = AbortSignal.timeout(5_000);
        const meta = (await extractMeta(file, "video", signal)).raw;
        // A probe cut off by the time limit may only have met a busy moment.
        if (!signal.aborted) remember(file, stat, meta);
        return meta;
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
