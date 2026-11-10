// Durable per-file metadata: rating, favorite, last-accessed, play history,
// extracted ffprobe meta, and meta_key migration / orphan cleanup.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";
import { BOOKMARK_NEAR_EPS } from "./bookmarks.js";
import { metaKeyOf } from "../tags.js";
import type { ExtractedMeta } from "../media.js";
import { resumePointOf } from "../../../shared/resume.js";

/**
 * Insert-or-update the file_meta row for a file, applying `mutate` to the column being set.
 *
 * The `column` literal-union type is the ONLY thing keeping this safe from SQL injection
 * (it is concatenated into the SQL string). Do not relax it to `string`.
 */
function upsertMeta(
  db: DB,
  fileId: number,
  column: "rating" | "favorite" | "last_accessed_at" | "thumb_offset_sec",
  value: number | null,
): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare(
    `INSERT INTO file_meta (meta_key, ${column}, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(meta_key) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
  ).run(metaKey, value, nowUnix());
}

export function setRating(db: DB, fileId: number, rating: number): void {
  upsertMeta(db, fileId, "rating", Math.max(0, Math.min(5, rating)));
}

export function setFavorite(db: DB, fileId: number, favorite: boolean): void {
  upsertMeta(db, fileId, "favorite", favorite ? 1 : 0);
}

/** Durable per-file fields a bulk edit can set. Omitted fields are left alone. */
export interface BulkMetaPatch {
  favorite?: boolean;
  /** 0..5; 0 clears the rating, matching the per-file control. */
  rating?: number;
}

/** What one {@link bulkSetMeta} call wrote. */
export interface BulkMetaResult {
  /** Files written. */
  files: number;
  /** Files whose row was already gone — not an error. */
  skipped: number;
}

/**
 * Set favorite and/or rating across many files in one transaction.
 *
 * Deliberately does not report churn the way the bulk tag edit does: a flag set
 * to what it already held is still a write, and the selection bar has nothing to
 * say about the difference — it flips the whole selection to one state.
 *
 * Writes are per meta_key, so two copies of the same file resolve to one row.
 * Both are still counted, because both are files the user selected.
 */
export function bulkSetMeta(
  db: DB,
  fileIds: number[],
  patch: BulkMetaPatch,
): BulkMetaResult {
  const result: BulkMetaResult = { files: 0, skipped: 0 };
  const sets: string[] = [];
  const values: number[] = [];
  // The column names are literals from this function, never from the caller —
  // the same rule upsertMeta relies on.
  if (patch.favorite !== undefined) {
    sets.push("favorite");
    values.push(patch.favorite ? 1 : 0);
  }
  if (patch.rating !== undefined) {
    sets.push("rating");
    // The IPC schema already bounds this to an integer 0..5; clamping again
    // keeps the range true for callers inside main (tests, future jobs), the
    // same way setRating does. The schema stays the authority for the renderer.
    values.push(Math.max(0, Math.min(5, Math.trunc(patch.rating))));
  }
  const ids = [...new Set(fileIds)];
  if (sets.length === 0 || ids.length === 0) return result;

  const columns = ["meta_key", ...sets, "updated_at"].join(", ");
  const placeholders = new Array(sets.length + 2).fill("?").join(", ");
  const updates = [...sets, "updated_at"]
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const upsert = db.prepare(
    `INSERT INTO file_meta (${columns}) VALUES (${placeholders})
     ON CONFLICT(meta_key) DO UPDATE SET ${updates}`,
  );
  const selectKey = db.prepare("SELECT meta_key AS k FROM files WHERE id = ?");

  const run = db.transaction(() => {
    const now = nowUnix();
    for (const fileId of ids) {
      const row = selectKey.get(fileId) as { k: string } | undefined;
      if (!row?.k) {
        result.skipped++;
        continue;
      }
      upsert.run(row.k, ...values, now);
      result.files++;
    }
  });
  run();
  return result;
}

/** Record the user-chosen thumbnail offset (seconds). Pass null to revert to the auto frame. */
export function setThumbOffset(
  db: DB,
  fileId: number,
  sec: number | null,
): void {
  const v = sec == null ? null : Number.isFinite(sec) && sec >= 0 ? sec : null;
  upsertMeta(db, fileId, "thumb_offset_sec", v);
}

/** Currently-recorded thumbnail offset, or null when the auto frame is in use. */
export function thumbOffsetOf(db: DB, fileId: number): number | null {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return null;
  return thumbOffsetByKey(db, metaKey);
}

export function thumbOffsetByKey(db: DB, metaKey: string): number | null {
  const row = db
    .prepare("SELECT thumb_offset_sec AS s FROM file_meta WHERE meta_key = ?")
    .get(metaKey) as { s: number | null } | undefined;
  return row?.s ?? null;
}

/** Record that a file's detail was opened (last-accessed timestamp, video and image alike). */
export function recordAccess(db: DB, fileId: number): void {
  upsertMeta(db, fileId, "last_accessed_at", nowUnix());
}

export function recordPlay(
  db: DB,
  fileId: number,
  via: "browser" | "external",
  position: number | null,
): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare(
    "INSERT INTO play_history (meta_key, played_at, position, via) VALUES (?, ?, ?, ?)",
  ).run(metaKey, nowUnix(), position, via);
  // Playing (or launching externally) counts as viewing the file: keep last-accessed fresh.
  recordAccess(db, fileId);
}

/** Where playback of a file stands (see {@link savePlayPosition}). */
export interface PlayPosition {
  /** Seconds into the file. */
  position: number;
  /** The player's own duration; the stored one is used when absent. */
  duration?: number | null;
  /** Playback ran to the end. */
  ended?: boolean;
}

/**
 * Record where playback stopped: the position on the file's newest in-app play
 * event (so the history shows where it stopped rather than where it started),
 * and the resume point the next open starts from — cleared once the file is
 * finished (see resumePointOf). Returns the resume point stored, or undefined
 * when the file row is gone.
 */
export function savePlayPosition(
  db: DB,
  fileId: number,
  { position, duration, ended = false }: PlayPosition,
): number | null | undefined {
  const row = db
    .prepare("SELECT meta_key AS k, duration AS d FROM files WHERE id = ?")
    .get(fileId) as { k: string; d: number | null } | undefined;
  if (!row) return undefined;
  const resume = resumePointOf(position, duration ?? row.d, ended);
  db.transaction(() => {
    db.prepare(
      `UPDATE play_history SET position = ? WHERE id =
         (SELECT id FROM play_history WHERE meta_key = ? AND via = 'browser'
          ORDER BY played_at DESC, id DESC LIMIT 1)`,
    ).run(position, row.k);
    if (resume == null) {
      // Nothing to keep: clear an existing point, but create no row for it.
      db.prepare(
        "UPDATE file_meta SET resume_position = NULL, updated_at = ? WHERE meta_key = ? AND resume_position IS NOT NULL",
      ).run(nowUnix(), row.k);
    } else {
      db.prepare(
        `INSERT INTO file_meta (meta_key, resume_position, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(meta_key) DO UPDATE SET resume_position = excluded.resume_position, updated_at = excluded.updated_at`,
      ).run(row.k, resume, nowUnix());
    }
  })();
  return resume;
}

/** The probed fields. resetIndex (jobs.ts) clears the same list for a rebuild; keep them in step. */
export function updateExtractedMeta(
  db: DB,
  fileId: number,
  m: ExtractedMeta,
): void {
  db.prepare(
    "UPDATE files SET width = ?, height = ?, duration = ?, codec = ?, fps = ?, captured_at = COALESCE(?, captured_at), meta = COALESCE(?, meta) WHERE id = ?",
  ).run(
    m.width,
    m.height,
    m.duration,
    m.codec,
    m.fps,
    m.capturedAt,
    m.raw == null ? null : JSON.stringify(m.raw),
    fileId,
  );
}

/**
 * How a file_meta row merges into one already held under the same meta_key
 * (specs/015-shared-user-metadata/research.md, R5), as the SET list of an
 * `ON CONFLICT (meta_key) DO UPDATE`: favorite is OR and rating the higher one;
 * the thumbnail frame and the resume point come from whichever row was updated
 * last, unless that row has none, since updated_at also moves when only the
 * rating or favorite changed. SET expressions all read the row as it was
 * before this update, and merging the same row again changes nothing.
 */
export const FILE_META_MERGE_SET = `
  rating = MAX(rating, excluded.rating),
  favorite = MAX(favorite, excluded.favorite),
  last_accessed_at = MAX(
    COALESCE(last_accessed_at, excluded.last_accessed_at),
    COALESCE(excluded.last_accessed_at, last_accessed_at)),
  thumb_offset_sec = CASE WHEN excluded.updated_at > updated_at
    THEN COALESCE(excluded.thumb_offset_sec, thumb_offset_sec)
    ELSE COALESCE(thumb_offset_sec, excluded.thumb_offset_sec) END,
  resume_position = CASE WHEN excluded.updated_at > updated_at
    THEN COALESCE(excluded.resume_position, resume_position)
    ELSE COALESCE(resume_position, excluded.resume_position) END,
  updated_at = MAX(updated_at, excluded.updated_at)`;

/**
 * Carry durable metadata from one meta_key to another (used when a file's content_hash
 * first appears and its meta_key shifts from the path fallback to the hash). The target
 * may already hold metadata, typically another workspace's copy of the same content in
 * the shared library: file_meta is merged into it (FILE_META_MERGE_SET), a tag the
 * target already carries keeps the target's row, and a bookmark near one the target
 * has is dropped.
 */
export function migrateMetaKey(db: DB, fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO file_meta
         (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
       SELECT ?, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at
       FROM file_meta WHERE meta_key = ?
       ON CONFLICT (meta_key) DO UPDATE SET ${FILE_META_MERGE_SET}`,
    ).run(toKey, fromKey);
    db.prepare("DELETE FROM file_meta WHERE meta_key = ?").run(fromKey);
    db.prepare(
      "UPDATE OR IGNORE meta_tags SET meta_key = ? WHERE meta_key = ?",
    ).run(toKey, fromKey);
    db.prepare("DELETE FROM meta_tags WHERE meta_key = ?").run(fromKey);
    db.prepare("UPDATE play_history SET meta_key = ? WHERE meta_key = ?").run(
      toKey,
      fromKey,
    );
    // As the library merge does (BOOKMARK_NEAR_EPS): a bookmark close to one
    // the target holds already is not carried over a second time. A range on
    // sec, searched in (meta_key, sec).
    db.prepare(
      `DELETE FROM scene_bookmarks
        WHERE meta_key = ? AND EXISTS (
          SELECT 1 FROM scene_bookmarks t
           WHERE t.meta_key = ?
             AND t.sec BETWEEN scene_bookmarks.sec - ? AND scene_bookmarks.sec + ?)`,
    ).run(fromKey, toKey, BOOKMARK_NEAR_EPS, BOOKMARK_NEAR_EPS);
    db.prepare(
      "UPDATE scene_bookmarks SET meta_key = ? WHERE meta_key = ?",
    ).run(toKey, fromKey);
  })();
}

/**
 * Copy a file's metadata to the key of its new content, for a file whose
 * content changed in place (#263): the path, not only the hash, tells it is
 * the same file. The old key keeps its copy, since another file may still have
 * the old content. Merged into what the new key holds as migrateMetaKey does
 * (a play already recorded, or a bookmark near one it has, is not added
 * again). Only the user's tags are copied: the derived ones (resolution,
 * codec...) describe the old content, and the new one gets its own.
 */
export function copyMetaKey(db: DB, fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO file_meta
         (meta_key, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at)
       SELECT ?, rating, favorite, last_accessed_at, thumb_offset_sec, resume_position, updated_at
       FROM file_meta WHERE meta_key = ?
       ON CONFLICT (meta_key) DO UPDATE SET ${FILE_META_MERGE_SET}`,
    ).run(toKey, fromKey);
    db.prepare(
      `INSERT OR IGNORE INTO meta_tags (meta_key, tag_id, source, score)
       SELECT ?, tag_id, source, score FROM meta_tags
        WHERE meta_key = ? AND source = 'manual'`,
    ).run(toKey, fromKey);
    db.prepare(
      `INSERT INTO play_history (meta_key, played_at, position, via)
       SELECT ?, s.played_at, s.position, s.via FROM play_history s
        WHERE s.meta_key = ? AND NOT EXISTS (
          SELECT 1 FROM play_history t
           WHERE t.meta_key = ? AND t.played_at = s.played_at AND t.via = s.via
             AND t.position IS s.position)`,
    ).run(toKey, fromKey, toKey);
    db.prepare(
      `INSERT INTO scene_bookmarks (meta_key, sec, created_at)
       SELECT ?, s.sec, s.created_at FROM scene_bookmarks s
        WHERE s.meta_key = ? AND NOT EXISTS (
          SELECT 1 FROM scene_bookmarks t
           WHERE t.meta_key = ? AND t.sec BETWEEN s.sec - ? AND s.sec + ?)`,
    ).run(toKey, fromKey, toKey, BOOKMARK_NEAR_EPS, BOOKMARK_NEAR_EPS);
  })();
}

/**
 * Drop tags no file carries any more, so tag completion does not keep offering
 * them. Metadata itself is never dropped for lack of a file row: it lives in
 * the library every workspace shares, where a key missing from this
 * workspace's `files` may belong to another workspace, or to one removed and
 * about to be added again.
 */
export function pruneUnusedTags(db: DB): void {
  db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM meta_tags)");
}
