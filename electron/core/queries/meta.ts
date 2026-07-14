// Durable per-file metadata: rating, favorite, last-accessed, play history,
// extracted ffprobe meta, and meta_key migration / orphan cleanup.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";
import { metaKeyOf } from "../tags.js";
import type { ExtractedMeta } from "../media.js";

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
