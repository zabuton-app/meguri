// Per-file thumbnail status (path on disk + status flag).
import type { DB } from "../db.js";

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
): { id: number; abs_path: string; kind: string }[] {
  return db
    .prepare(
      "SELECT id, abs_path, kind FROM files WHERE root_id = ? AND deleted_at IS NULL AND thumb_status = 'pending'",
    )
    .all(rootId) as { id: number; abs_path: string; kind: string }[];
}
