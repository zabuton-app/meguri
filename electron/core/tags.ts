// Operations on tags and meta_tags. Used for manual tags, plugin tags, and FTS sync.
// Tags are keyed by the stable meta_key (resolved from a file id) rather than files.id,
// so they survive rebuilding the files table.
import { resyncFtsForKeys, type DB } from "./db.js";
import type { TagInfo } from "./types.js";
import {
  RESERVED_TAG_ERROR,
  isReservedTagName,
  tagIdentityKey,
  tidyTagName,
} from "../../shared/tags.js";

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

/**
 * The user's tag a name means: the one whose name has the same tagIdentityKey,
 * or null when there is none. Where a library holds two such spellings from
 * before that rule (`Trip` and `trip`), the one spelled exactly as asked, and
 * otherwise the older one — as auto tagging picks (see tagIdResolver in
 * autoTag.ts). Exact first, so a chip the user picked is the tag they get.
 * `except` leaves one tag out, for a rename asking what else the new name
 * would mean.
 */
export function findManualTag(
  db: DB,
  name: string,
  except?: number,
): number | null {
  const id = db
    .prepare(
      "SELECT id FROM tags WHERE namespace = '' AND tag_key(name) = ? AND id IS NOT ? ORDER BY name = ? DESC, id LIMIT 1",
    )
    .pluck()
    .get(tagIdentityKey(name), except ?? null, name) as number | undefined;
  return id ?? null;
}

/**
 * The user's tag for a name, created in that spelling when there is none. An
 * existing one keeps its own: typing `Trip` beside a `trip` reuses `trip`.
 */
export function manualTagId(db: DB, name: string): number {
  return findManualTag(db, name) ?? upsertTag(db, "", name);
}

/**
 * Attach a user-created tag — the one already there under another spelling,
 * if any (see manualTagId). Names that would impersonate a pipeline-owned
 * namespace are rejected here rather than silently creating a manual tag that
 * renders identically to a generated one.
 */
export function addManualTag(db: DB, fileId: number, name: string): number {
  // Nothing left once tidied (only invisible characters): every such name
  // would be one tag (see tagIdentityKey).
  if (!tidyTagName(name)) throw new Error("empty tag name");
  if (isReservedTagName(name)) {
    throw new Error(`${RESERVED_TAG_ERROR}: ${name}`);
  }
  const tagId = manualTagId(db, name);
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

/** What one {@link bulkEditManualTags} call actually changed. */
export interface BulkTagEdit {
  /** Selected files whose tag set came out different. */
  files: number;
  /** Selected files whose row was already gone — not an error. */
  skipped: number;
  /**
   * (meta_key, tag) pairs attached. Counted per meta_key, which is what the
   * database stores: two selected copies of the same file share one row, so
   * tagging both is one pair and two files.
   */
  added: number;
  /** (meta_key, tag) pairs detached, counted the same way. */
  removed: number;
}

/**
 * Attach and detach user-created tags across many files in one transaction.
 *
 * Tags are addressed by name rather than by id because the caller works across
 * workspaces, where the same tag is a different row in every database. Names to
 * add are created where they do not exist yet; names to remove that no database
 * row matches are simply no-ops — the caller aggregated them from a selection
 * that may span several workspaces, so a name missing here is expected.
 *
 * Names to add resolve to the tag they mean under any spelling (see
 * manualTagId), so `Trip` lands on the `trip` a workspace already has. Names
 * to remove stay exact: they come from tags the selection showed, each a row
 * of its own, and a library from before that rule may hold `Trip` and `trip`
 * both — removing one must not take the other.
 *
 * The edit is expressed as a final state, not as a sequence: a tag both lists
 * name is treated as an addition and dropped from the removals, so the same
 * request always converges on the same tags and reports no churn for a file
 * that already had them.
 *
 * Work is done per meta_key, not per file id. Two files with the same content
 * hash share one metadata identity, so writing per file would attach the tag
 * once, see no change on the second, and leave that file's FTS row stale while
 * its tags had in fact moved.
 *
 * Reserved names are rejected before anything is written: a bulk edit that
 * stopped halfway is much harder to reason about than one that never started.
 */
export function bulkEditManualTags(
  db: DB,
  fileIds: number[],
  add: string[],
  remove: string[],
): BulkTagEdit {
  const addNames = [
    ...new Set(add.map((n) => n.trim()).filter((n) => tidyTagName(n))),
  ];
  const removeNames = [...new Set(remove.map((n) => n.trim()).filter(Boolean))];
  for (const name of addNames) {
    if (isReservedTagName(name)) {
      throw new Error(`${RESERVED_TAG_ERROR}: ${name}`);
    }
  }
  const ids = [...new Set(fileIds)];
  const result: BulkTagEdit = { files: 0, skipped: 0, added: 0, removed: 0 };
  if (ids.length === 0 || (addNames.length === 0 && removeNames.length === 0)) {
    return result;
  }

  const selectId = db.prepare(
    "SELECT id FROM tags WHERE namespace = '' AND name = ?",
  );
  const attach = db.prepare(
    "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, 'manual', NULL) ON CONFLICT(meta_key, tag_id, source) DO NOTHING",
  );
  const detach = db.prepare(
    "DELETE FROM meta_tags WHERE meta_key = ? AND tag_id = ? AND source = 'manual'",
  );

  const run = db.transaction(() => {
    // Names resolve to ids once, not once per file. Additions create the tag
    // here so the id exists before the first attach; removals only look, since
    // creating a tag in order to detach it would leave an unused row behind.
    const addIds = [...new Set(addNames.map((name) => manualTagId(db, name)))];
    const removeIds = removeNames
      .map((name) => (selectId.get(name) as { id: number } | undefined)?.id)
      .filter((id): id is number => id != null && !addIds.includes(id));

    const keyOf = new Map<number, string>();
    for (const fileId of ids) {
      const metaKey = metaKeyOf(db, fileId);
      if (metaKey) keyOf.set(fileId, metaKey);
      else result.skipped++;
    }

    const changed = new Set<string>();
    for (const metaKey of new Set(keyOf.values())) {
      let touched = 0;
      for (const tagId of removeIds) {
        touched += detach.run(metaKey, tagId).changes;
      }
      const removedHere = touched;
      for (const tagId of addIds) {
        touched += attach.run(metaKey, tagId).changes;
      }
      if (touched === 0) continue;
      result.removed += removedHere;
      result.added += touched - removedHere;
      changed.add(metaKey);
    }

    // Reported as "files the user selected that moved", so both copies of a
    // duplicate count — which is what the selection showed them.
    for (const metaKey of keyOf.values()) {
      if (changed.has(metaKey)) result.files++;
    }
    // One set-based pass instead of a delete+insert per file: it also covers
    // files behind a changed key that were never in the selection, whose tags
    // moved all the same.
    resyncFtsForKeys(db, [...changed]);
  });
  run();
  return result;
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
       WHERE mt.meta_key = ? ORDER BY mt.source, t.namespace, t.name`,
    )
    .all(metaKey) as TagInfo[];
}

/** Searchable text for files_fts: the user's own tag names, deduplicated across
 *  sources. Must stay in step with FTS_ROW_SELECT in db.ts — same set of names,
 *  same separator. Generated (namespaced) tags are excluded on purpose; see the
 *  comment on that constant. */
export function tagsText(db: DB, fileId: number): string {
  const names = new Set(
    fileTags(db, fileId)
      .filter((t) => t.namespace === "")
      .map((t) => t.name),
  );
  return [...names].sort().join(" ");
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
  // Manual completion only: a namespaced tag is pipeline-owned and the user is
  // not allowed to create one, so offering it would be a dead end.
  // ORDER BY must match idx_tags_manual_name's NOCASE collation — with the default
  // BINARY collation SQLite can use the index for the prefix range but still
  // needs a temp b-tree for the sort.
  const rows = db
    .prepare(
      "SELECT name FROM tags WHERE namespace = '' AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ?",
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
