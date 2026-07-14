// Per-scan-root operations: registration, last-scan timestamp, soft-delete from index.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";

export function upsertScanRoot(db: DB, root: string, hash: string): number {
  db.prepare(
    "INSERT INTO scan_roots (path, path_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET path_hash = excluded.path_hash",
  ).run(root, hash, nowUnix());
  return (
    db.prepare("SELECT id FROM scan_roots WHERE path = ?").get(root) as {
      id: number;
    }
  ).id;
}

export function touchScanRoot(db: DB, rootId: number): void {
  db.prepare("UPDATE scan_roots SET last_scan_at = ? WHERE id = ?").run(
    nowUnix(),
    rootId,
  );
}

/** Last completed-scan timestamp for the workspace (max across registered roots; usually one row). */
export function lastScanAt(db: DB): number | null {
  const row = db
    .prepare("SELECT MAX(last_scan_at) AS t FROM scan_roots")
    .get() as { t: number | null } | undefined;
  return row?.t ?? null;
}

/** Visible file count for the workspace — matches what the list query returns (soft-deleted excluded). */
export function countFiles(db: DB): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM files WHERE deleted_at IS NULL")
    .get() as { c: number };
  return row.c;
}

export function clearExcludedFiles(db: DB, rootId: number): number {
  const info = db
    .prepare(
      "UPDATE files SET excluded_at = NULL WHERE root_id = ? AND excluded_at IS NOT NULL",
    )
    .run(rootId);
  return info.changes;
}

export function deleteFromIndex(
  db: DB,
  fileId: number,
): { id: number; relPath: string } {
  const now = nowUnix();
  const row = db
    .prepare(
      "SELECT rel_path AS relPath FROM files WHERE id = ? AND deleted_at IS NULL",
    )
    .get(fileId) as { relPath: string } | undefined;
  if (!row) throw new Error("file not found");

  const tx = db.transaction(() => {
    const info = db
      .prepare("UPDATE files SET deleted_at = ?, excluded_at = ? WHERE id = ?")
      .run(now, now, fileId);
    if (info.changes !== 1) throw new Error("failed to delete file from index");
    db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(fileId);
  });
  tx();
  const verified = db
    .prepare(
      "SELECT deleted_at AS deletedAt, excluded_at AS excludedAt FROM files WHERE id = ?",
    )
    .get(fileId) as
    { deletedAt: number | null; excludedAt: number | null } | undefined;
  const fts = db
    .prepare("SELECT rowid FROM files_fts WHERE rowid = ?")
    .get(fileId);
  if (!verified?.deletedAt || !verified.excludedAt || fts) {
    throw new Error("failed to verify file was deleted from index");
  }
  return { id: fileId, relPath: row.relPath };
}
