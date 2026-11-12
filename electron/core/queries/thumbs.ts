// Per-file thumbnail status (path on disk + status flag).
import type { DB } from "../db.js";
import { getSetting, setSetting } from "./settings.js";

export function setThumb(
  db: DB,
  fileId: number,
  thumbPath: string | null,
  status: string,
): void {
  db.prepare(
    "UPDATE files SET thumb_path = ?, thumb_status = ? WHERE id = ?",
  ).run(thumbPath, status, fileId);
}

export function filesNeedingThumb(
  db: DB,
  rootId: number,
): { id: number; rel_path: string; abs_path: string; kind: string }[] {
  return db
    .prepare(
      "SELECT id, rel_path, abs_path, kind FROM files WHERE root_id = ? AND deleted_at IS NULL AND thumb_status = 'pending'",
    )
    .all(rootId) as {
    id: number;
    rel_path: string;
    abs_path: string;
    kind: string;
  }[];
}

/** Requeue failed HEIF thumbs and old thumbs whose grid size was unknown. */
export function retryLegacyHeifThumbnails(db: DB, rootId: number): void {
  const key = `heif_thumbnail_retry_v1:${rootId}`;
  db.transaction(() => {
    if (getSetting(db, key) !== null) return;
    db.prepare(
      `UPDATE files SET thumb_status = 'pending'
       WHERE root_id = ? AND deleted_at IS NULL AND kind = 'image'
         AND ext IN ('heic', 'heif')
         AND (thumb_status = 'error'
           OR (thumb_status = 'done' AND (width IS NULL OR height IS NULL)))`,
    ).run(rootId);
    setSetting(db, key, "1");
  })();
}
