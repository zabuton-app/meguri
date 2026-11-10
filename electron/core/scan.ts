// Recursive scan: enumeration (walk), content_hash, incremental sync (move/rename tracking).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DB } from "./db.js";
import { nowUnix, pathMetaKey } from "./db.js";
import { migrateMetaKey } from "./queries.js";
import { pool } from "./concurrency.js";
import type { Kind } from "./types.js";

// Concurrency for parallelizing IO waits on network FS such as SMB.
// Kept modest because too high would hit the server's connection limit.
const SCAN_IO_CONCURRENCY = 8;
// Chunk tx size / interval for yielding to the event loop.
const DB_CHUNK = 500;
const YIELD_EVERY = 256;

/** Return control to the event loop (keeps the UI responsive). */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "webm",
  "mov",
  "avi",
  "m4v",
  "wmv",
  "flv",
  // Shared with TypeScript sources: walk() confirms it with looksLikeMpegTs().
  "ts",
]);
const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "avif",
  "heic",
  "heif",
]);

// Restricted to what Chromium decodes natively, so playback needs no transcode path
// and no new dependency. Extensions outside this set stay unlisted rather than being
// registered as something the player cannot open. No collision with VIDEO_EXTS: that
// set holds m4v, this one m4a.
const AUDIO_EXTS = new Set(["mp3", "m4a", "aac", "flac", "ogg", "opus", "wav"]);

export function kindForExt(ext: string): Kind | null {
  const e = ext.toLowerCase();
  if (VIDEO_EXTS.has(e)) return "video";
  if (IMAGE_EXTS.has(e)) return "image";
  if (AUDIO_EXTS.has(e)) return "audio";
  return null;
}

// MPEG transport stream packets start with this sync byte. The `ts` extension is
// shared with TypeScript sources, so the extension alone can't tell them apart.
const TS_SYNC_BYTE = 0x47;
const TS_PACKET = 188;
// M2TS (Blu-ray / AVCHD) prefixes each packet with a 4-byte timecode.
const M2TS_PACKET = 192;
const M2TS_PREFIX = 4;
// Packets inspected per candidate layout. Requiring the sync byte in several
// consecutive packets keeps a text file that happens to start with "G" out.
const TS_PROBE_PACKETS = 4;
const TS_MIN_PACKETS = 2;

/** `stride` is the full packet size including the `prefix` before the sync byte. */
function hasSyncRun(
  buf: Buffer,
  len: number,
  prefix: number,
  stride: number,
): boolean {
  // Only whole packets count: a trailing partial packet is ignored.
  const packets = Math.min(TS_PROBE_PACKETS, Math.floor(len / stride));
  if (packets < TS_MIN_PACKETS) return false;
  for (let i = 0; i < packets; i++) {
    if (buf[prefix + i * stride] !== TS_SYNC_BYTE) return false;
  }
  return true;
}

/**
 * Whether the file's head looks like an MPEG transport stream (plain 188-byte
 * packets, or the 192-byte M2TS layout). Streams whose first packet is not at
 * offset 0 are not recognized.
 *
 * A file that vanished counts as not a stream. Any other read error keeps the
 * extension's verdict (true): a transient failure on a network FS must not drop
 * an indexed recording, the same as for other extensions once stat succeeded.
 */
export async function looksLikeMpegTs(file: string): Promise<boolean> {
  const buf = Buffer.alloc(M2TS_PACKET * TS_PROBE_PACKETS);
  let len = 0;
  let fd: fsp.FileHandle;
  try {
    fd = await fsp.open(file, "r");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
  try {
    // Network filesystems may return short reads; fill the probe window.
    while (len < buf.length) {
      const { bytesRead } = await fd.read(buf, len, buf.length - len, len);
      if (bytesRead === 0) break;
      len += bytesRead;
    }
  } catch {
    return true;
  } finally {
    await fd.close().catch(() => {});
  }
  return (
    hasSyncRun(buf, len, 0, TS_PACKET) ||
    hasSyncRun(buf, len, M2TS_PREFIX, M2TS_PACKET)
  );
}

// Dependency trees of code repositories: never media, and often huge.
const SKIPPED_DIRS = new Set(["node_modules"]);

export interface Discovered {
  absPath: string;
  relPath: string;
  ext: string;
  kind: Kind;
  size: number;
  mtime: number;
  /** Filesystem creation time (birthtime), null where the FS doesn't provide it. */
  btime: number | null;
  inode: number;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/**
 * A predicate for rows walk() could not reach: the path itself, or anything
 * under a directory, reported through onUnreadablePath. O(depth) per check, so
 * it stays cheap with many reported paths.
 */
export function unreadableMatcher(
  unreadablePaths: readonly string[],
): (relPath: string) => boolean {
  const paths = new Set(unreadablePaths);
  return (relPath) => {
    if (paths.size === 0) return false;
    for (let p = relPath; ;) {
      if (paths.has(p)) return true;
      const parent = path.dirname(p);
      if (parent === p || parent === ".") return false;
      p = parent;
    }
  };
}

/**
 * Recursively enumerate media files under the root. Hidden directories and
 * dependency directories (node_modules) are excluded, and `.ts` files are kept
 * only when their content is an MPEG transport stream.
 * Directory traversal (readdir) and file stat run in concurrent pools so that IO
 * waits don't stall even on network FS such as SMB (the main thread yields to the
 * event loop on each await, so it doesn't freeze).
 *
 * A root that cannot be read throws: an unplugged drive or a share that is down
 * must not look like an empty folder. A subdirectory or a file that exists but
 * cannot be read (permission denied, a share dropping mid-walk) is reported
 * through onUnreadablePath (relative to the root) and skipped; one that is gone
 * (ENOENT / ENOTDIR) is simply not found.
 */
export async function walk(
  root: string,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
  onUnreadablePath?: (relPath: string) => void,
): Promise<Discovered[]> {
  const reportUnreadable = (full: string, code: string | undefined) => {
    if (code === "ENOENT" || code === "ENOTDIR") return; // gone, not unreadable
    onUnreadablePath?.(path.relative(root, full));
  };
  const out: Discovered[] = [];
  // Directories pending traversal. Dequeued in BFS order, with discovered child directories appended.
  let level: string[] = [root];
  while (level.length) {
    if (signal?.aborted) break;
    const next: string[] = [];
    const statTargets: { full: string; ext: string; kind: Kind }[] = [];

    // readdir this level's directories concurrently.
    await pool(
      level,
      SCAN_IO_CONCURRENCY,
      async (dir) => {
        if (signal?.aborted) return;
        let entries: fs.Dirent[];
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (err) {
          const code = errorCode(err);
          if (dir === root) {
            // No path in the message: the scan log may be shared.
            throw new Error(
              `the scan root cannot be read (${code ?? "unknown"})`,
            );
          }
          reportUnreadable(dir, code);
          return;
        }
        for (const ent of entries) {
          if (ent.isSymbolicLink()) continue;
          if (ent.name.startsWith(".")) continue; // exclude hidden
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (SKIPPED_DIRS.has(ent.name)) continue;
            if (!signal?.aborted) next.push(full);
            continue;
          }
          if (!ent.isFile()) continue;
          const ext = path.extname(ent.name).replace(/^\./, "").toLowerCase();
          const kind = kindForExt(ext);
          if (!kind) continue;
          statTargets.push({ full, ext, kind });
        }
      },
      signal,
    );

    // stat the files found at this level concurrently.
    await pool(
      statTargets,
      SCAN_IO_CONCURRENCY,
      async (t) => {
        if (signal?.aborted) return;
        let st: fs.Stats;
        try {
          st = await fsp.stat(t.full);
        } catch (err) {
          reportUnreadable(t.full, errorCode(err));
          return;
        }
        // Only the ambiguous extension pays for the extra read.
        if (t.ext === "ts" && !(await looksLikeMpegTs(t.full))) return;
        out.push({
          absPath: t.full,
          relPath: path.relative(root, t.full),
          ext: t.ext,
          kind: t.kind,
          size: st.size,
          mtime: Math.floor(st.mtimeMs / 1000),
          // Filesystems without birthtime report 0 (or the epoch) — store NULL.
          btime: st.birthtimeMs > 0 ? Math.floor(st.birthtimeMs / 1000) : null,
          inode: Number(st.ino),
        });
        // Total is unknown until the whole tree is traversed, so report the running count (indeterminate).
        if (out.length % 32 === 0) onProgress?.(out.length);
      },
      signal,
    );

    onProgress?.(out.length);
    level = next;
  }
  return out;
}

const SAMPLE = 1024 * 1024; // 1 MiB

/** Sampled content_hash (sha256 of size + the first/last 1MiB). */
export async function contentHash(file: string): Promise<string> {
  const h = createHash("sha256");
  const fd = await fsp.open(file, "r");
  try {
    const size = (await fd.stat()).size;
    h.update(Buffer.from(BigInt64Array.of(BigInt(size)).buffer));
    if (size <= SAMPLE * 2) {
      const buf = Buffer.alloc(size);
      await fd.read(buf, 0, size, 0);
      h.update(buf);
    } else {
      const head = Buffer.alloc(SAMPLE);
      await fd.read(head, 0, SAMPLE, 0);
      h.update(head);
      const tail = Buffer.alloc(SAMPLE);
      await fd.read(tail, 0, SAMPLE, size - SAMPLE);
      h.update(tail);
    }
  } finally {
    await fd.close();
  }
  return h.digest("hex");
}

export interface ScanStats {
  inserted: number;
  updated: number;
  moved: number;
  deleted: number;
  unchanged: number;
}

/** Stats for a scan that did nothing (aborted before starting, or failed). */
export function emptyScanStats(): ScanStats {
  return { inserted: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0 };
}

/**
 * Apply enumeration results to the DB. Returns the file ids of new/updated entries (which need thumbnails).
 *
 * Split into 3 stages to avoid freezing on SMB:
 *   1. Classify: determine existing rows by rel_path (lightweight SELECT only; yield every 256 entries).
 *   2. Concurrent hashing: precompute content_hash for new candidates in a concurrent pool (the main IO-parallelization win).
 *   3. DB apply: split discovered into chunks of DB_CHUNK, apply each chunk in a single transaction,
 *      and yield between chunks. Move detection uses values in the DB, so it doesn't depend on chunk order.
 *
 * ftsTargets are the file ids that need FTS re-sync (inserted/moved/updated). unchanged ones are excluded.
 * unreadablePaths are directories and files (relative to the root) that walk()
 * could not read: their rows (a file's own row, or every row under a directory)
 * are kept as they are instead of being soft-deleted, and are not taken over by
 * move detection.
 */
export async function syncFiles(
  db: DB,
  rootId: number,
  discovered: Discovered[],
  onHashProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  unreadablePaths: readonly string[] = [],
): Promise<{ stats: ScanStats; needsThumb: number[]; ftsTargets: number[] }> {
  const stats: ScanStats = {
    inserted: 0,
    updated: 0,
    moved: 0,
    deleted: 0,
    unchanged: 0,
  };
  const needsThumb: number[] = [];
  const ftsTargets: number[] = [];
  const excluded = new Set(
    (
      db
        .prepare(
          "SELECT rel_path FROM files WHERE root_id = ? AND excluded_at IS NOT NULL",
        )
        .all(rootId) as { rel_path: string }[]
    ).map((r) => r.rel_path),
  );
  const scannable = discovered.filter((d) => !excluded.has(d.relPath));
  const seen = new Set(scannable.map((d) => d.relPath));
  const now = nowUnix();

  // btime is refreshed here too so rows scanned before the column existed get
  // backfilled on the next scan without a content change.
  const touchUnchanged = db.prepare(
    "UPDATE files SET deleted_at = NULL, abs_path = ?, inode = ?, btime = ? WHERE id = ?",
  );
  // Recompute content_hash for changed files so meta_key stays anchored to the hash
  // (rather than dropping to the path fallback) and metadata keeps linking.
  const updateChanged = db.prepare(
    "UPDATE files SET size = ?, mtime = ?, btime = ?, abs_path = ?, inode = ?, content_hash = ?, thumb_status = 'pending', deleted_at = NULL WHERE id = ?",
  );
  const moveStmt = db.prepare(
    "UPDATE files SET rel_path = ?, abs_path = ?, inode = ?, mtime = ?, btime = ?, size = ?, deleted_at = NULL WHERE id = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO files (root_id, rel_path, abs_path, kind, ext, size, mtime, btime, inode, content_hash, thumb_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const moveCandidates = db.prepare(
    "SELECT id, rel_path, kind, ext FROM files WHERE root_id = ? AND content_hash = ? AND size = ? AND excluded_at IS NULL",
  );
  // A move can change the extension, and with it the kind (the same MPEG-4 bytes
  // are video as .mp4 and audio as .m4a). The row would otherwise keep the old
  // kind forever, since later scans see it as unchanged.
  const reclassifyMoved = db.prepare(
    "UPDATE files SET kind = ?, ext = ?, thumb_path = NULL, thumb_status = 'pending' WHERE id = ?",
  );

  type Existing =
    | {
        id: number;
        size: number;
        mtime: number;
        content_hash: string | null;
        /** The key its metadata is stored under (META_KEY_EXPR). */
        meta_key: string;
      }
    | undefined;

  // --- 1. Classify (look up existing rows, keeping indices aligned with discovered) ---
  // One bulk SELECT + in-memory Map instead of a synchronous per-file SELECT
  // (N statements on the main thread added up on large roots). Same pattern as
  // the excluded-set fetch above.
  const existingByRelPath = new Map<string, NonNullable<Existing>>(
    (
      db
        .prepare(
          "SELECT id, rel_path, meta_key, size, mtime, content_hash FROM files WHERE root_id = ?",
        )
        .all(rootId) as {
        id: number;
        rel_path: string;
        meta_key: string;
        size: number;
        mtime: number;
        content_hash: string | null;
      }[]
    ).map((r) => [
      r.rel_path,
      {
        id: r.id,
        size: r.size,
        mtime: r.mtime,
        content_hash: r.content_hash,
        meta_key: r.meta_key,
      },
    ]),
  );
  // hashIdx holds new files (move detection) plus changed files (content_hash refresh).
  const existingOf: Existing[] = new Array<Existing>(scannable.length);
  const hashIdx: number[] = [];
  for (let i = 0; i < scannable.length; i++) {
    if (signal?.aborted) break;
    const existing = existingByRelPath.get(scannable[i].relPath);
    existingOf[i] = existing;
    if (!existing) {
      hashIdx.push(i);
    } else if (
      existing.size !== scannable[i].size ||
      existing.mtime !== scannable[i].mtime
    ) {
      hashIdx.push(i);
    }
    if ((i + 1) % YIELD_EVERY === 0) await yieldToLoop();
  }

  // --- 2. Compute content_hash for new + changed candidates concurrently ---
  // On network FS (SMB) this reads 2 MiB per file, so report progress (determinate total).
  const hashOf = new Map<number, string>();
  const hashTotal = hashIdx.length;
  let hashed = 0;
  await pool(
    hashIdx,
    SCAN_IO_CONCURRENCY,
    async (idx) => {
      if (signal?.aborted) return;
      hashOf.set(idx, await contentHash(scannable[idx].absPath));
      hashed++;
      if (hashed % 8 === 0 || hashed === hashTotal)
        onHashProgress?.(hashed, hashTotal);
    },
    signal,
  );

  if (signal?.aborted) return { stats, needsThumb, ftsTargets };

  // Rows walk() could not reach were not seen, but may well still be there.
  const isUnreadable = unreadableMatcher(unreadablePaths);

  // --- 3. DB apply (chunked tx + yield between chunks) ---
  const applyChunk = db.transaction((idxs: number[]) => {
    for (const i of idxs) {
      const d = scannable[i];
      const existing = existingOf[i];
      if (existing) {
        // A row without a hash keys its metadata by its path (the path
        // fallback). The update below can change that key: a hash appears, or
        // the path written differs from the stored one. Its metadata follows,
        // from the key the row derived before.
        const carryMeta = (newKey: string) => {
          if (existing.content_hash == null && existing.meta_key !== newKey) {
            migrateMetaKey(db, existing.meta_key, newKey);
          }
        };
        if (existing.size === d.size && existing.mtime === d.mtime) {
          carryMeta(pathMetaKey(d.absPath));
          touchUnchanged.run(d.absPath, d.inode, d.btime, existing.id);
          stats.unchanged++;
        } else {
          const newHash = hashOf.get(i) ?? null;
          carryMeta(newHash ?? pathMetaKey(d.absPath));
          updateChanged.run(
            d.size,
            d.mtime,
            d.btime,
            d.absPath,
            d.inode,
            newHash,
            existing.id,
          );
          needsThumb.push(existing.id);
          ftsTargets.push(existing.id);
          stats.updated++;
        }
        continue;
      }
      // New or moved: look for move candidates using the precomputed content_hash.
      // hash can be missing if the file's hashing was skipped (e.g. aborted just
      // before this apply ran). Fall back to null — never bind undefined (which
      // better-sqlite3 rejects, rolling back the whole chunk tx) — and skip move
      // detection in that case (a null hash can't be matched to a candidate anyway;
      // the row inserts with content_hash NULL and uses the path fallback key).
      const hash = hashOf.get(i) ?? null;
      const cands =
        hash != null
          ? (moveCandidates.all(rootId, hash, d.size) as {
              id: number;
              rel_path: string;
              kind: string;
              ext: string | null;
            }[])
          : [];
      // A candidate walk() could not reach is probably still in place: this
      // is a copy, not a move.
      const moved = cands.find(
        (c) => !seen.has(c.rel_path) && !isUnreadable(c.rel_path),
      );
      if (moved) {
        moveStmt.run(
          d.relPath,
          d.absPath,
          d.inode,
          d.mtime,
          d.btime,
          d.size,
          moved.id,
        );
        // Re-derive kind/ext from the new name; a changed kind also invalidates
        // the old thumbnail (audio has none, video and image differ).
        if (moved.kind !== d.kind || moved.ext !== d.ext) {
          reclassifyMoved.run(d.kind, d.ext, moved.id);
          if (d.kind !== "audio") needsThumb.push(moved.id);
        }
        ftsTargets.push(moved.id);
        stats.moved++;
      } else {
        const info = insertStmt.run(
          rootId,
          d.relPath,
          d.absPath,
          d.kind,
          d.ext,
          d.size,
          d.mtime,
          d.btime,
          d.inode,
          hash,
          now,
        );
        const id = Number(info.lastInsertRowid);
        needsThumb.push(id);
        ftsTargets.push(id);
        stats.inserted++;
      }
    }
  });

  for (let start = 0; start < scannable.length; start += DB_CHUNK) {
    if (signal?.aborted) break;
    const idxs: number[] = [];
    for (let i = start; i < Math.min(start + DB_CHUNK, scannable.length); i++)
      idxs.push(i);
    applyChunk(idxs);
    await yieldToLoop();
  }

  if (signal?.aborted) return { stats, needsThumb, ftsTargets };

  // Soft-delete existing rows not seen this time (in a single transaction at the end).
  const softDelete = db.transaction(() => {
    const alive = db
      .prepare(
        "SELECT id, rel_path FROM files WHERE root_id = ? AND deleted_at IS NULL",
      )
      .all(rootId) as { id: number; rel_path: string }[];
    const del = db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?");
    for (const row of alive) {
      if (!seen.has(row.rel_path) && !isUnreadable(row.rel_path)) {
        del.run(now, row.id);
        stats.deleted++;
      }
    }
  });
  softDelete();

  return { stats, needsThumb, ftsTargets };
}
