// Shared helpers for core DB tests. Not a test file itself (no ".test" suffix).
import { openDb, nowUnix, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";

export interface FileSeed {
  relPath: string;
  kind?: "video" | "image" | "audio";
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

/**
 * The metadata tables a workspace DB held itself before the shared library
 * (copied from CORE_DDL as it was then, with the columns backfillColumns added).
 * Emulates a legacy on-disk DB: once these exist in `main`, unqualified queries
 * reach them rather than the attached library.
 */
export const LEGACY_METADATA_DDL = `
CREATE TABLE main.tags (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT '',
  UNIQUE (namespace, name)
);
CREATE TABLE main.file_meta (
  meta_key TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_accessed_at INTEGER,
  thumb_offset_sec REAL,
  resume_position REAL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE main.meta_tags (
  meta_key TEXT NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL, score REAL,
  PRIMARY KEY (meta_key, tag_id, source)
);
CREATE TABLE main.play_history (
  id INTEGER PRIMARY KEY, meta_key TEXT NOT NULL,
  played_at INTEGER NOT NULL, position REAL, via TEXT NOT NULL CHECK (via IN ('browser','external'))
);
CREATE TABLE main.scene_bookmarks (
  id INTEGER PRIMARY KEY,
  meta_key TEXT NOT NULL,
  sec REAL NOT NULL CHECK (sec >= 0),
  created_at INTEGER NOT NULL
);
`;

/** Open an in-memory DB with a single scan root registered; returns the DB and its rootId. */
export function newDb(): { db: DB; rootId: number } {
  const db = openDb(":memory:", ":memory:");
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
