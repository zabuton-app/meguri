// Catalog-level tag operations for the tag management screen: aggregate listing
// plus rename / merge / delete. Everything here works on ONE workspace database;
// fanning out across the workspaces in scope is main.ts's job.
//
// Tags are addressed by (namespace, name), never by tags.id — ids are
// database-local and meaningless in the cross-workspace "All" view.
import { resyncFtsForKeys, type DB } from "./db.js";
import {
  RESERVED_TAG_ERROR,
  isEditableTag,
  isReservedTagName,
} from "../../shared/tags.js";
import type { TagRef } from "./types.js";

/** One tag's aggregate within a single database. */
export interface TagAggRow {
  namespace: string;
  name: string;
  fileCount: number;
  bySource: { source: string; count: number }[];
}

/**
 * Counts are distinct *alive* files, so the numbers agree with what the library
 * shows. Joining `files` (rather than a correlated EXISTS per meta_tags row)
 * lets idx_files_meta_key drive the lookup; COUNT(DISTINCT meta_key) is immune
 * to the row multiplication the join can introduce. The INNER JOIN on meta_tags
 * means tags with no remaining assignment never appear.
 */
const ALIVE_JOIN = `FROM tags t
       JOIN meta_tags mt ON mt.tag_id = t.id
       JOIN files f ON f.meta_key = mt.meta_key AND f.deleted_at IS NULL`;

export function listTags(db: DB): TagAggRow[] {
  const totals = db
    .prepare(
      `SELECT t.id AS id, t.namespace AS namespace, t.name AS name,
              COUNT(DISTINCT mt.meta_key) AS n
       ${ALIVE_JOIN}
        GROUP BY t.id`,
    )
    .all() as { id: number; namespace: string; name: string; n: number }[];

  const perSource = db
    .prepare(
      `SELECT t.id AS id, mt.source AS source, COUNT(DISTINCT mt.meta_key) AS n
       ${ALIVE_JOIN}
        GROUP BY t.id, mt.source
        ORDER BY mt.source`,
    )
    .all() as { id: number; source: string; n: number }[];

  const sources = new Map<number, { source: string; count: number }[]>();
  for (const r of perSource) {
    let arr = sources.get(r.id);
    if (!arr) {
      arr = [];
      sources.set(r.id, arr);
    }
    arr.push({ source: r.source, count: r.n });
  }

  return totals.map((t) => ({
    namespace: t.namespace,
    name: t.name,
    fileCount: t.n,
    bySource: sources.get(t.id) ?? [],
  }));
}

/** Pipeline-owned tags are rewritten on every scan; editing one would be undone. */
function assertEditable(ref: TagRef): void {
  if (!isEditableTag(ref.namespace)) {
    throw new Error(`tag is pipeline-owned: ${ref.namespace}:${ref.name}`);
  }
}

function tagIdOf(db: DB, ref: TagRef): number | null {
  const row = db
    .prepare("SELECT id FROM tags WHERE namespace = ? AND name = ?")
    .get(ref.namespace, ref.name) as { id: number } | undefined;
  return row?.id ?? null;
}

/** The meta_keys currently linked to any of these tag ids (the FTS resync scope). */
function keysForTagIds(db: DB, ids: number[]): string[] {
  if (ids.length === 0) return [];
  return db
    .prepare(
      `SELECT DISTINCT meta_key FROM meta_tags
        WHERE tag_id IN (SELECT value FROM json_each(?))`,
    )
    .pluck()
    .all(JSON.stringify(ids)) as string[];
}

/**
 * Rename a manual tag. When the target name is already taken this escalates to a
 * merge, which is what the user is asked to confirm in the UI.
 */
export function renameTag(
  db: DB,
  from: TagRef,
  to: string,
): { merged: boolean; affectedFiles: number } {
  assertEditable(from);
  const next = to.trim();
  if (!next) throw new Error("empty tag name");
  if (isReservedTagName(next)) {
    throw new Error(`${RESERVED_TAG_ERROR}: ${next}`);
  }

  const fromId = tagIdOf(db, from);
  if (fromId == null) return { merged: false, affectedFiles: 0 };
  const target: TagRef = { namespace: "", name: next };
  const targetId = tagIdOf(db, target);
  if (targetId === fromId) return { merged: false, affectedFiles: 0 };
  if (targetId != null) {
    return { merged: true, ...mergeTags(db, [from], target) };
  }

  return db.transaction(() => {
    // Assignments are untouched by a plain rename — only tags_text changes.
    const keys = keysForTagIds(db, [fromId]);
    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(next, fromId);
    resyncFtsForKeys(db, keys);
    return { merged: false, affectedFiles: keys.length };
  })();
}

/**
 * Fold `from` tags into `into`.
 *
 * meta_tags' primary key is (meta_key, tag_id, source), so per-source rows move
 * across independently and all of them survive. Where both tags already had a
 * row for the same (meta_key, source), UPDATE OR IGNORE keeps the target's row —
 * and therefore the target's score — and the loser is swept up afterwards.
 */
export function mergeTags(
  db: DB,
  from: TagRef[],
  into: TagRef,
): { affectedFiles: number } {
  assertEditable(into);
  // The target may be created below, so it goes through the same name check as
  // addManualTag and renameTag — otherwise merge would be a back door to a
  // manual tag that renders identically to a generated one.
  if (isReservedTagName(into.name)) {
    throw new Error(`${RESERVED_TAG_ERROR}: ${into.name}`);
  }
  for (const ref of from) assertEditable(ref);

  return db.transaction(() => {
    let intoId = tagIdOf(db, into);
    const fromIds = from
      .map((ref) => tagIdOf(db, ref))
      .filter((id): id is number => id != null && id !== intoId);
    if (fromIds.length === 0) return { affectedFiles: 0 };
    if (intoId == null) {
      db.prepare(
        "INSERT INTO tags (name, namespace) VALUES (?, '') ON CONFLICT(namespace, name) DO NOTHING",
      ).run(into.name);
      intoId = tagIdOf(db, into);
      if (intoId == null) throw new Error("could not create the merge target");
    }

    const keys = keysForTagIds(db, fromIds);
    const idsJson = JSON.stringify(fromIds);
    db.prepare(
      `UPDATE OR IGNORE meta_tags SET tag_id = ?
        WHERE tag_id IN (SELECT value FROM json_each(?))`,
    ).run(intoId, idsJson);
    // Rows the conflict rejected are still pointing at the old tag.
    db.prepare(
      "DELETE FROM meta_tags WHERE tag_id IN (SELECT value FROM json_each(?))",
    ).run(idsJson);
    db.prepare(
      "DELETE FROM tags WHERE id IN (SELECT value FROM json_each(?))",
    ).run(idsJson);
    resyncFtsForKeys(db, keys);
    return { affectedFiles: keys.length };
  })();
}

/** Remove tags outright; ON DELETE CASCADE drops their assignments. */
export function deleteTags(
  db: DB,
  refs: TagRef[],
): { removedTags: number; affectedFiles: number } {
  for (const ref of refs) assertEditable(ref);

  return db.transaction(() => {
    const ids = refs
      .map((ref) => tagIdOf(db, ref))
      .filter((id): id is number => id != null);
    if (ids.length === 0) return { removedTags: 0, affectedFiles: 0 };
    const keys = keysForTagIds(db, ids);
    db.prepare(
      "DELETE FROM tags WHERE id IN (SELECT value FROM json_each(?))",
    ).run(JSON.stringify(ids));
    resyncFtsForKeys(db, keys);
    return { removedTags: ids.length, affectedFiles: keys.length };
  })();
}
