// Shared helpers for core DB tests. Not a test file itself (no ".test" suffix).
import { openDb, nowUnix, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";

export interface FileSeed {
  relPath: string;
  kind?: "video" | "image";
  ext?: string;
  size?: number;
  mtime?: number;
  btime?: number | null;
  contentHash?: string | null;
  capturedAt?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  codec?: string | null;
}

/** Open an in-memory DB with a single scan root registered; returns the DB and its rootId. */
export function newDb(): { db: DB; rootId: number } {
  const db = openDb(":memory:");
  const rootId = upsertScanRoot(db, "/fake/root", "deadbeef");
  return { db, rootId };
}

/** Insert a file row directly (bypassing the filesystem-backed scan) and return its id. */
export function insertFile(db: DB, rootId: number, seed: FileSeed): number {
  const ext = seed.ext ?? seed.relPath.split(".").pop() ?? "mp4";
  const info = db
    .prepare(
      `INSERT INTO files
        (root_id, rel_path, abs_path, kind, ext, size, mtime, btime, content_hash,
         width, height, duration, codec, captured_at, thumb_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      rootId,
      seed.relPath,
      `/fake/root/${seed.relPath}`,
      seed.kind ?? "video",
      ext,
      seed.size ?? 1000,
      seed.mtime ?? 1000,
      seed.btime ?? null,
      seed.contentHash ?? null,
      seed.width ?? null,
      seed.height ?? null,
      seed.duration ?? null,
      seed.codec ?? null,
      seed.capturedAt ?? null,
      nowUnix(),
    );
  return Number(info.lastInsertRowid);
}
