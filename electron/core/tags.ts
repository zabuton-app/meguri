// Operations on tags and meta_tags. Used for manual tags, plugin tags, and FTS sync.
// Tags are keyed by the stable meta_key (resolved from a file id) rather than files.id,
// so they survive rebuilding the files table.
import type { DB } from "./db.js";
import type { TagInfo } from "./types.js";

/** Resolve a file id to its stable meta_key (null if the file row is gone). */
export function metaKeyOf(db: DB, fileId: number): string | null {
  const row = db
    .prepare("SELECT meta_key FROM files WHERE id = ?")
    .get(fileId) as { meta_key: string } | undefined;
  return row?.meta_key ?? null;
}

export function upsertTag(db: DB, namespace: string, name: string): number {
  db.prepare(
    "INSERT INTO tags (name, namespace) VALUES (?, ?) ON CONFLICT(namespace, name) DO NOTHING",
  ).run(name, namespace);
  const row = db
    .prepare("SELECT id FROM tags WHERE namespace = ? AND name = ?")
    .get(namespace, name) as { id: number };
  return row.id;
}

export function addFileTag(
  db: DB,
  fileId: number,
  tagId: number,
  source: string,
  score: number | null,
): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare(
    "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, ?, ?) ON CONFLICT(meta_key, tag_id, source) DO UPDATE SET score = excluded.score",
  ).run(metaKey, tagId, source, score);
}

export function addManualTag(db: DB, fileId: number, name: string): number {
  const tagId = upsertTag(db, "", name);
  addFileTag(db, fileId, tagId, "manual", null);
  return tagId;
}

export function removeManualTag(db: DB, fileId: number, tagId: number): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare(
    "DELETE FROM meta_tags WHERE meta_key = ? AND tag_id = ? AND source = 'manual'",
  ).run(metaKey, tagId);
}

export function clearTagsBySource(
  db: DB,
  fileId: number,
  source: string,
): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare("DELETE FROM meta_tags WHERE meta_key = ? AND source = ?").run(
    metaKey,
    source,
  );
}

export function fileTags(db: DB, fileId: number): TagInfo[] {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return [];
  return db
    .prepare(
      `SELECT t.id, t.name, t.namespace, mt.source, mt.score
       FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.meta_key = ? ORDER BY t.name`,
    )
    .all(metaKey) as TagInfo[];
}

export function tagsText(db: DB, fileId: number): string {
  return fileTags(db, fileId)
    .map((t) => t.name)
    .join(" ");
}

export function syncFts(db: DB, fileId: number): void {
  const row = db
    .prepare("SELECT rel_path FROM files WHERE id = ?")
    .get(fileId) as { rel_path: string } | undefined;
  if (!row) return;
  const text = tagsText(db, fileId);
  db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(fileId);
  db.prepare(
    "INSERT INTO files_fts (rowid, rel_path, tags_text) VALUES (?, ?, ?)",
  ).run(fileId, row.rel_path, text);
}

export function listTagNames(db: DB, prefix: string, limit: number): string[] {
  const escaped = prefix
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const rows = db
    .prepare(
      "SELECT name FROM tags WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?",
    )
    .all(`${escaped}%`, Math.max(1, Math.min(100, limit))) as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

export function absPathOf(db: DB, fileId: number): string | null {
  const row = db
    .prepare("SELECT abs_path FROM files WHERE id = ? AND deleted_at IS NULL")
    .get(fileId) as { abs_path: string } | undefined;
  return row?.abs_path ?? null;
}

export function thumbPathIfDone(db: DB, fileId: number): string | null {
  const row = db
    .prepare(
      "SELECT thumb_path FROM files WHERE id = ? AND thumb_status = 'done'",
    )
    .get(fileId) as { thumb_path: string | null } | undefined;
  return row?.thumb_path ?? null;
}
