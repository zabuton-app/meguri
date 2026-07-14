// Recursive scan: enumeration (walk), content_hash, incremental sync (move/rename tracking).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DB } from "./db.js";
import { nowUnix } from "./db.js";
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

export function kindForExt(ext: string): Kind | null {
  const e = ext.toLowerCase();
  if (VIDEO_EXTS.has(e)) return "video";
  if (IMAGE_EXTS.has(e)) return "image";
  return null;
}

export interface Discovered {
  absPath: string;
  relPath: string;
  ext: string;
  kind: Kind;
  size: number;
  mtime: number;
  inode: number;
}

/**
 * Recursively enumerate media files under the root. Hidden directories are excluded.
 * Directory traversal (readdir) and file stat run in concurrent pools so that IO
 * waits don't stall even on network FS such as SMB (the main thread yields to the
 * event loop on each await, so it doesn't freeze).
 */
export async function walk(
  root: string,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<Discovered[]> {
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
        } catch {
          return;
        }
        for (const ent of entries) {
          if (ent.isSymbolicLink()) continue;
          if (ent.name.startsWith(".")) continue; // exclude hidden
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
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
        } catch {
          return;
        }
        out.push({
          absPath: t.full,
          relPath: path.relative(root, t.full),
          ext: t.ext,
          kind: t.kind,
          size: st.size,
          mtime: Math.floor(st.mtimeMs / 1000),
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
 */
export async function syncFiles(
  db: DB,
  rootId: number,
  discovered: Discovered[],
  onHashProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
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

  const findExisting = db.prepare(
    "SELECT id, size, mtime, content_hash FROM files WHERE root_id = ? AND rel_path = ?",
  );
  const touchUnchanged = db.prepare(
    "UPDATE files SET deleted_at = NULL, abs_path = ?, inode = ? WHERE id = ?",
  );
  // Recompute content_hash for changed files so meta_key stays anchored to the hash
  // (rather than dropping to the rel_path fallback) and metadata keeps linking.
  const updateChanged = db.prepare(
    "UPDATE files SET size = ?, mtime = ?, abs_path = ?, inode = ?, content_hash = ?, thumb_status = 'pending', deleted_at = NULL WHERE id = ?",
  );
  const moveStmt = db.prepare(
    "UPDATE files SET rel_path = ?, abs_path = ?, inode = ?, mtime = ?, size = ?, deleted_at = NULL WHERE id = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO files (root_id, rel_path, abs_path, kind, ext, size, mtime, inode, content_hash, thumb_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const moveCandidates = db.prepare(
    "SELECT id, rel_path FROM files WHERE root_id = ? AND content_hash = ? AND size = ? AND excluded_at IS NULL",
  );

  type Existing =
    | { id: number; size: number; mtime: number; content_hash: string | null }
    | undefined;

  // --- 1. Classify (look up existing rows, keeping indices aligned with discovered) ---
  // hashIdx holds new files (move detection) plus changed files (content_hash refresh).
  const existingOf: Existing[] = new Array<Existing>(scannable.length);
  const hashIdx: number[] = [];
  for (let i = 0; i < scannable.length; i++) {
    if (signal?.aborted) break;
    const existing = findExisting.get(rootId, scannable[i].relPath) as Existing;
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

  // --- 3. DB apply (chunked tx + yield between chunks) ---
  const applyChunk = db.transaction((idxs: number[]) => {
    for (const i of idxs) {
      const d = scannable[i];
      const existing = existingOf[i];
      if (existing) {
        if (existing.size === d.size && existing.mtime === d.mtime) {
          touchUnchanged.run(d.absPath, d.inode, existing.id);
          stats.unchanged++;
        } else {
          const newHash = hashOf.get(i) ?? null;
          // If the file had no hash before (meta was keyed by the rel_path fallback) and
          // now gains one, carry its metadata over to the hash-based meta_key.
          if (newHash && existing.content_hash == null) {
            migrateMetaKey(db, `p:${rootId}:${d.relPath}`, newHash);
          }
          updateChanged.run(
            d.size,
            d.mtime,
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
      // the row inserts with content_hash NULL and uses the rel_path meta_key).
      const hash = hashOf.get(i) ?? null;
      const cands =
        hash != null
          ? (moveCandidates.all(rootId, hash, d.size) as {
              id: number;
              rel_path: string;
            }[])
          : [];
      const moved = cands.find((c) => !seen.has(c.rel_path));
      if (moved) {
        moveStmt.run(d.relPath, d.absPath, d.inode, d.mtime, d.size, moved.id);
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
      if (!seen.has(row.rel_path)) {
        del.run(now, row.id);
        stats.deleted++;
      }
    }
  });
  softDelete();

  return { stats, needsThumb, ftsTargets };
}
