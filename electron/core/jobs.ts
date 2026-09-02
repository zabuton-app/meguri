// Scan pipeline: walk → sync → thumbnail/meta (parallel).
// Progress is reported via callbacks.
import fsp from "node:fs/promises";
import path from "node:path";
import type { Core } from "./index.js";
import { walk, syncFiles, type ScanStats } from "./scan.js";
import { extractMeta, generateThumb } from "./media.js";
import * as q from "./queries.js";
import { syncFts } from "./tags.js";
import {
  applyAutoMetaTags,
  backfillAutoMetaTags,
  needsAutoMetaBackfill,
} from "./autoMetaTags.js";
import { pool } from "./concurrency.js";
import {
  LARGE_IMAGE_PIXELS,
  SCAN_POOL_WIDTH,
  withScanDecodeSlot,
} from "./mediaConcurrency.js";
import { scopedLog } from "./logger.js";
import type { Kind } from "./types.js";

const log = scopedLog("scan");

export type JobEvent =
  | {
      type: "progress";
      jobId: string;
      phase: string;
      done: number;
      total: number;
    }
  | { type: "thumbDone"; id: number }
  | { type: "done"; jobId: string; stats: ScanStats; aborted?: boolean };

/**
 * Drop the file index (files + FTS rows for this root) and its thumbnails, so the next
 * scan rebuilds them from scratch. Durable metadata (file_meta / meta_tags / play_history)
 * is keyed by meta_key, not files.id, so it is intentionally left untouched and re-links
 * to the freshly-scanned rows automatically.
 *
 * Note: the removed-from-index exclusions (files.excluded_at) live on the files rows and are
 * therefore wiped too — a rebuild deliberately resets that list, so files previously removed
 * from the index reappear. This is spelled out in the rebuild confirmation dialog.
 */
async function clearIndex(core: Core): Promise<void> {
  const { db } = core;
  db.transaction(() => {
    db.prepare(
      "DELETE FROM files_fts WHERE rowid IN (SELECT id FROM files WHERE root_id = ?)",
    ).run(core.rootId);
    db.prepare("DELETE FROM files WHERE root_id = ?").run(core.rootId);
  })();
  // Thumbnails are named by the (now invalidated) file id, so wipe them to avoid
  // orphans. Async with a small concurrent pool — a synchronous unlink loop over
  // tens of thousands of thumbnails would block the main thread.
  const thumbs = core.thumbsDir();
  let names: string[] = [];
  try {
    names = await fsp.readdir(thumbs);
  } catch {
    return; // thumbs dir may not exist yet
  }
  await pool(names, 8, async (name) => {
    try {
      await fsp.rm(path.join(thumbs, name), { force: true });
    } catch {
      /* best-effort; a leftover thumb is overwritten by the rescan */
    }
  });
}

export async function runScan(
  core: Core,
  jobId: string,
  onEvent: (e: JobEvent) => void,
  opts: { rebuild?: boolean; signal?: AbortSignal } = {},
): Promise<ScanStats> {
  const { signal } = opts;
  const { db } = core;

  // A rebuild discards the derived file index (keeping durable metadata) before rescanning.
  if (opts.rebuild) await clearIndex(core);

  // --- walk + sync (both async with concurrent IO, so they don't block the event loop) ---
  // On SMB these phases dominate the time before thumbnails start, so report their progress.
  const discovered = await walk(
    core.root,
    (count) =>
      onEvent({
        type: "progress",
        jobId,
        phase: "walk",
        done: count,
        total: 0,
      }),
    signal,
  );

  if (signal?.aborted) {
    const empty: ScanStats = {
      inserted: 0,
      updated: 0,
      moved: 0,
      deleted: 0,
      unchanged: 0,
    };
    onEvent({ type: "done", jobId, stats: empty, aborted: true });
    return empty;
  }

  const { stats, ftsTargets } = await syncFiles(
    db,
    core.rootId,
    discovered,
    (done, total) =>
      onEvent({ type: "progress", jobId, phase: "hash", done, total }),
    signal,
  );
  q.touchScanRoot(db, core.rootId);

  // Sync FTS only for new/moved/updated entries (unchanged ones need no re-sync).
  const ftsTotal = ftsTargets.length;
  let done = 0;
  for (const id of ftsTargets) {
    if (signal?.aborted) break;
    syncFts(db, id);
    done++;
    if (done % 64 === 0 || done === ftsTotal) {
      onEvent({
        type: "progress",
        jobId,
        phase: "index",
        done,
        total: ftsTotal,
      });
      // Yield to the event loop every 256 entries.
      if (done % 256 === 0) await new Promise((r) => setImmediate(r));
    }
  }

  if (signal?.aborted) {
    onEvent({ type: "done", jobId, stats, aborted: true });
    return stats;
  }

  // --- thumbnail/meta (parallel) ---
  const pending = q.filesNeedingThumb(db, core.rootId);
  const total = pending.length;
  let processed = 0;
  const thumbs = core.thumbsDir();

  // Persist results in batches: one transaction per THUMB_FLUSH_EVERY files
  // instead of one implicit commit (+ FTS delete/insert) per file, which
  // multiplied WAL commits by the file count on a full scan. Progress and
  // thumbDone events are emitted per flush (after the commit, so the renderer's
  // thumbnail request sees thumb_status = 'done'), which also throttles the
  // previously per-file scan:progress IPC traffic.
  type ThumbResult = {
    id: number;
    kind: Kind;
    dest: string;
    ok: boolean;
    meta: Awaited<ReturnType<typeof extractMeta>>;
  };
  const THUMB_FLUSH_EVERY = 32;
  let buffer: ThumbResult[] = [];

  const persistOne = (r: ThumbResult): void => {
    q.updateExtractedMeta(db, r.id, r.meta);
    q.setThumb(db, r.id, r.ok ? r.dest : null, r.ok ? "done" : "error");
    // Derive from what was just written, and before syncFts — which rebuilds
    // tags_text by re-reading meta_tags.
    applyAutoMetaTags(db, r.id, { kind: r.kind, ...r.meta });
    syncFts(db, r.id);
  };
  // Per-file transaction for the retry path: persistOne spans several writes
  // (incl. the FTS delete+insert), so a mid-way failure must roll back the
  // whole file rather than leave partial state (e.g. an FTS row deleted but
  // never re-inserted).
  const persistOneTx = db.transaction(persistOne);

  const flush = (): void => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const persisted: ThumbResult[] = [];
    try {
      db.transaction(() => {
        for (const r of batch) persistOne(r);
      })();
      persisted.push(...batch);
    } catch (e) {
      // A DB error (SQLITE_BUSY, disk full, constraint) rolls back the whole
      // batch; retry per file so one bad row can't discard its batchmates.
      // Files that still fail stay 'pending' and are retried next scan.
      log.warn("thumb/meta batch persist failed, retrying per file:", e);
      for (const r of batch) {
        try {
          persistOneTx(r);
          persisted.push(r);
        } catch (err) {
          log.warn(`failed to persist thumb/meta for file ${r.id}:`, err);
        }
      }
    }
    for (const r of persisted) {
      if (r.ok) onEvent({ type: "thumbDone", id: r.id });
    }
    // Only successfully persisted rows advance the progress counter — failed
    // rows stay 'pending' and are retried next scan (same as the old per-file
    // semantics, where a failed persist did not count as done).
    processed += persisted.length;
    onEvent({
      type: "progress",
      jobId,
      phase: "thumbnail",
      done: processed,
      total,
    });
  };

  // Per-file worker. Never throws: a pool worker that rejects would abandon
  // its siblings mid-flight (still writing to this DB after the scan has
  // reported as finished), so per-file failures are logged and the file is
  // left 'pending' for the next scan. Failures are counted so a tool that is
  // broken outright (every file failing) still surfaces as a scan error.
  let failed = 0;
  const processOne = async (f: (typeof pending)[number]): Promise<void> => {
    if (signal?.aborted) return;
    const kind = f.kind as Kind;
    const dest = path.join(thumbs, `${f.id}.webp`);
    try {
      // ffprobe runs outside the decode slot: it doesn't decode, but it can be
      // slow on network shares and must not hold a decoder up meanwhile.
      const meta = await extractMeta(f.abs_path, signal);
      // Honour a user-chosen thumbnail frame if one was set previously. Ignored for images.
      const offsetSec =
        kind === "video" ? (q.thumbOffsetOf(db, f.id) ?? undefined) : undefined;
      const thumb = () =>
        generateThumb(f.abs_path, kind, dest, signal, offsetSec);
      // Only the expensive decodes take a slot: every video, and images big
      // enough to cost hundreds of MB — or of unknown size (ffprobe failed),
      // which are treated as big. Everything else runs at pool width.
      const pixels =
        meta.width != null && meta.height != null
          ? meta.width * meta.height
          : Infinity;
      const expensive = kind === "video" || pixels >= LARGE_IMAGE_PIXELS;
      const ok = expensive
        ? await withScanDecodeSlot(thumb, signal)
        : await thumb();

      // If aborted mid-flight, ffprobe/ffmpeg were killed and returned partial/empty
      // results. Don't persist them or mark the file 'error' (which filesNeedingThumb
      // skips on rescan) — leave it 'pending' so the next scan retries it.
      if (signal?.aborted) return;

      // ffmpeg reporting failure counts too, so a broken ffmpeg (every file
      // marked 'error') is caught by the all-failed check below.
      if (!ok) failed++;
      // Workers share the event loop, so buffering + flushing is race-free.
      buffer.push({ id: f.id, kind, dest, ok, meta });
      if (buffer.length >= THUMB_FLUSH_EVERY) flush();
    } catch (err) {
      if (signal?.aborted) return;
      failed++;
      log.warn(`thumbnail worker failed for ${f.id}:`, err);
    }
  };
  // Images and videos run in separate pools (mediaConcurrency.ts has the
  // width and the reasoning): a run of videos must not block the cheap image
  // side, and the expensive decodes are bounded process-wide inside
  // processOne, together with the media server's. Both pools are awaited to
  // completion regardless of failure, and whatever completed is persisted
  // before any failure propagates.
  const images = pending.filter((f) => f.kind !== "video");
  const videos = pending.filter((f) => f.kind === "video");
  try {
    const results = await Promise.allSettled([
      pool(images, SCAN_POOL_WIDTH, processOne, signal),
      pool(videos, SCAN_POOL_WIDTH, processOne, signal),
    ]);
    for (const r of results) if (r.status === "rejected") throw r.reason;
    // Every file failing points at the tooling, not the files — but a single
    // corrupt file in a tiny incremental scan must not be mistaken for that.
    if (failed >= 3 && failed === pending.length && !signal?.aborted) {
      throw new Error(
        `thumbnail extraction failed for all ${failed} files (is ffmpeg/ffprobe working?)`,
      );
    }
  } finally {
    // Persist the tail batch. On abort the buffered results are from ffmpeg
    // runs that completed before the signal fired, so they are safe to keep.
    flush();
  }

  // Files classified as unchanged/moved never enter the pool above (syncFiles
  // leaves their thumb_status alone), so an existing library only gains derived
  // tags through this pass. It reads the ffprobe columns already on `files`, so
  // no media file is touched.
  if (!signal?.aborted && needsAutoMetaBackfill(db)) {
    await backfillAutoMetaTags(db, {
      signal,
      onProgress: (d, t) =>
        onEvent({ type: "progress", jobId, phase: "tags", done: d, total: t }),
    });
  }

  // Reclaim durable metadata whose file row no longer exists (mainly post-rebuild orphans).
  // Skipped on abort to avoid purging metadata for files not yet re-indexed (especially after rebuild).
  if (!signal?.aborted) q.pruneOrphanMeta(db);

  onEvent({ type: "done", jobId, stats, aborted: signal?.aborted });
  return stats;
}
