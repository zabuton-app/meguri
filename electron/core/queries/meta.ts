// Durable per-file metadata: rating, favorite, last-accessed, play history,
// extracted ffprobe meta, and meta_key migration / orphan cleanup.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";
import { metaKeyOf } from "../tags.js";
import type { ExtractedMeta } from "../media.js";
import { readAudioMetadata } from "../../../shared/audioMetadata.js";
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

export function updateExtractedMeta(
  db: DB,
  fileId: number,
  m: ExtractedMeta,
): void {
  const audio = readAudioMetadata(m.raw);
  db.prepare(
    "UPDATE files SET width = ?, height = ?, duration = ?, codec = ?, fps = ?, captured_at = COALESCE(?, captured_at), meta = COALESCE(?, meta), sample_rate = CASE WHEN ? THEN ? ELSE sample_rate END, bit_depth = CASE WHEN ? THEN ? ELSE bit_depth END, audio_channels = CASE WHEN ? THEN ? ELSE audio_channels END, audio_bit_rate = CASE WHEN ? THEN ? ELSE audio_bit_rate END WHERE id = ?",
  ).run(
    m.width,
    m.height,
    m.duration,
    m.codec,
    m.fps,
    m.capturedAt,
    m.raw == null ? null : JSON.stringify(m.raw),
    m.raw != null ? 1 : 0,
    audio.sampleRate,
    m.raw != null ? 1 : 0,
    audio.bitDepth,
    m.raw != null ? 1 : 0,
    audio.channels,
    m.raw != null ? 1 : 0,
    audio.bitRate,
    fileId,
  );
}

/**
 * Carry durable metadata from one meta_key to another (used when a file's content_hash
 * first appears and its meta_key shifts from the rel_path fallback to the hash). Rows that
 * would collide with an existing target are dropped (the target already holds metadata).
 */
export function migrateMetaKey(db: DB, fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  db.transaction(() => {
    db.prepare(
      "UPDATE OR IGNORE file_meta SET meta_key = ? WHERE meta_key = ?",
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
    db.prepare(
      "UPDATE scene_bookmarks SET meta_key = ? WHERE meta_key = ?",
    ).run(toKey, fromKey);
  })();
}

/**
 * Drop durable metadata that no longer maps to any file row. Soft-deleted files keep their
 * row (deleted_at set), so their meta_key still appears in `files` and is preserved — only
 * truly orphaned keys (e.g. left behind when a rebuild discards rows for files now gone from
 * disk) are removed. meta_key is a non-null generated column, so the NOT IN is safe.
 */
export function pruneOrphanMeta(db: DB): void {
  db.transaction(() => {
    db.exec(
      "DELETE FROM file_meta WHERE meta_key NOT IN (SELECT meta_key FROM files)",
    );
    db.exec(
      "DELETE FROM meta_tags WHERE meta_key NOT IN (SELECT meta_key FROM files)",
    );
    db.exec(
      "DELETE FROM play_history WHERE meta_key NOT IN (SELECT meta_key FROM files)",
    );
    db.exec(
      "DELETE FROM scene_bookmarks WHERE meta_key NOT IN (SELECT meta_key FROM files)",
    );
    // Tags are referenced only via meta_tags; drop any left with no references.
    db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM meta_tags)");
  })();
}
