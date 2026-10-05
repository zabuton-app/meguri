// Database side of auto-tagging: attaching the tags the engine (shared/
// autoTag.ts) proposes, taking them back, and running the engine over files a
// scan brought in.
//
// The tags are the user's own — source `manual`, no namespace — so everything
// the app can do with a hand-applied tag works on these too, and the full-text
// index has to follow every change.
import { resyncFtsForKeys, type DB } from "./db.js";
import { getSetting, setSetting } from "./queries/settings.js";
import {
  deriveAutoTagsInProcess,
  type AutoTagEngine,
  type DeriveAutoTags,
} from "./autoTagDeriver.js";
import { upsertTag } from "./tags.js";
import {
  MAX_AUTO_TAG_FILES,
  cleanTagName,
  fileNameOf,
  isUsableTagName,
  type AutoTagFile,
} from "../../shared/autoTag.js";

/** A tag attached to a file's metadata identity. */
export type TagPair = [metaKey: string, tagId: number];

export interface AttachResult {
  /** Of the files named, how many gained at least one tag. */
  files: number;
  /** Exactly the pairs this call attached — what an undo may remove. */
  pairs: TagPair[];
}

/**
 * Resolve a tag name to the user's tag it means, creating it when new. An
 * existing tag that differs only by case is reused, so `kids` from a file name
 * lands on the `Kids` the user already has instead of beside it.
 *
 * The fold is JavaScript's, the same one the engine and the screen compare tags
 * with — SQLite's NOCASE stops at ASCII, and would call `Été` and `été` two
 * tags after the screen had promised one. The catalog of own tags is small, so
 * it is read once per call rather than queried per name.
 */
function tagIdResolver(db: DB): (name: string) => number | null {
  const known = new Map<string, number | null>();
  const rows = db
    .prepare("SELECT id, name FROM tags WHERE namespace = '' ORDER BY id")
    .all() as { id: number; name: string }[];
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!known.has(key)) known.set(key, row.id);
  }
  return (raw) => {
    const name = cleanTagName(raw);
    const key = name.toLowerCase();
    let id = known.get(key);
    if (id === undefined) {
      id = isUsableTagName(name) ? upsertTag(db, "", name) : null;
      known.set(key, id);
    }
    return id;
  };
}

/**
 * Attach tags to files. Only adds: a tag the file already has is left alone and
 * is not reported, so undoing this call never removes something it did not put
 * there. Work is per meta_key (copies of a file share their tags), and the FTS
 * rows of every key that changed are re-synced.
 */
export function attachAutoTags(
  db: DB,
  assignments: readonly {
    fileIds: readonly number[];
    tags: readonly string[];
  }[],
): AttachResult {
  const metaKeyOf = db.prepare(
    "SELECT meta_key FROM files WHERE id = ? AND deleted_at IS NULL",
  );
  const attach = db.prepare(
    "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, 'manual', NULL) ON CONFLICT(meta_key, tag_id, source) DO NOTHING",
  );
  const run = db.transaction((): AttachResult => {
    const tagIdOf = tagIdResolver(db);
    const pairs: TagPair[] = [];
    const changed = new Set<string>();
    // Counted per file named, as bulkEditManualTags does: two selected copies
    // of one file are two files to the user, though one metadata identity.
    const touched = new Set<number>();
    for (const { fileIds, tags } of assignments) {
      const tagIds = [
        ...new Set(tags.map(tagIdOf).filter((id): id is number => id != null)),
      ];
      if (tagIds.length === 0) continue;
      for (const fileId of fileIds) {
        const row = metaKeyOf.get(fileId) as { meta_key: string } | undefined;
        if (!row) continue;
        let gained = changed.has(row.meta_key);
        for (const tagId of tagIds) {
          if (attach.run(row.meta_key, tagId).changes > 0) {
            pairs.push([row.meta_key, tagId]);
            changed.add(row.meta_key);
            gained = true;
          }
        }
        if (gained) touched.add(fileId);
      }
    }
    resyncFtsForKeys(db, [...changed]);
    return { files: touched.size, pairs };
  });
  return run();
}

/** Remove pairs a previous {@link attachAutoTags} reported. Returns how many went. */
export function detachTagPairs(db: DB, pairs: readonly TagPair[]): number {
  const detach = db.prepare(
    "DELETE FROM meta_tags WHERE meta_key = ? AND tag_id = ? AND source = 'manual'",
  );
  return db.transaction(() => {
    let removed = 0;
    const changed = new Set<string>();
    for (const [metaKey, tagId] of pairs) {
      if (detach.run(metaKey, tagId).changes > 0) {
        removed++;
        changed.add(metaKey);
      }
    }
    resyncFtsForKeys(db, [...changed]);
    return removed;
  })();
}

const CHUNK = 512;

interface NameRow {
  id: number;
  rel_path: string;
}

/**
 * Run the engine over files and attach what it proposes — every alive file, or
 * just `fileIds`. Chunked and yielding, so a large library does not park the
 * main process; `derive` is where the engine runs (the worker, in the app).
 */
export async function applyAutoTags(
  db: DB,
  opts: {
    engine: AutoTagEngine;
    derive?: DeriveAutoTags;
    fileIds?: readonly number[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{ files: number; added: number; completed: boolean }> {
  const { engine, fileIds, signal, onProgress } = opts;
  const derive = opts.derive ?? deriveAutoTagsInProcess;
  const byIds = db.prepare(
    `SELECT id, rel_path FROM files
      WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
  );
  const byPage = db.prepare(
    "SELECT id, rel_path FROM files WHERE deleted_at IS NULL AND id > ? ORDER BY id LIMIT ?",
  );
  const total = fileIds
    ? fileIds.length
    : (
        db
          .prepare("SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NULL")
          .get() as { n: number }
      ).n;

  let files = 0;
  let added = 0;
  let done = 0;
  let lastId = 0;
  for (;;) {
    if (signal?.aborted) return { files, added, completed: false };
    let rows: NameRow[];
    if (fileIds) {
      if (done >= fileIds.length) break;
      const ids = fileIds.slice(done, done + CHUNK);
      rows = byIds.all(JSON.stringify(ids)) as NameRow[];
      done += ids.length;
    } else {
      rows = byPage.all(lastId, CHUNK) as NameRow[];
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      done += rows.length;
    }
    const tags = await derive(
      engine,
      rows.map((row) => fileNameOf(row.rel_path)),
    );
    // The await let the caller cancel; nothing of this chunk is written yet.
    if (signal?.aborted) return { files, added, completed: false };
    const result = attachAutoTags(
      db,
      rows
        .map((row, i) => ({ fileIds: [row.id], tags: tags[i] }))
        .filter((a) => a.tags.length > 0),
    );
    files += result.files;
    added += result.pairs.length;
    onProgress?.(Math.min(done, total), total);
    await new Promise((r) => setImmediate(r));
  }
  return { files, added, completed: true };
}

/**
 * Files a scan brought in that the engine has not seen yet. Persisted, because
 * a scan aborted between indexing and tagging reports those files as unchanged
 * the next time round, and they would otherwise never be tagged.
 */
export const AUTO_TAG_PENDING_KEY = "auto_tag_pending";

function readPending(db: DB): number[] {
  try {
    const value: unknown = JSON.parse(
      getSetting(db, AUTO_TAG_PENDING_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((v): v is number => Number.isInteger(v))
      : [];
  } catch {
    return [];
  }
}

/** The scan hook: tag what this scan added or changed, plus anything still owed. */
export async function applyAutoTagsOnScan(
  db: DB,
  opts: {
    engine: AutoTagEngine;
    derive?: DeriveAutoTags;
    changedIds: readonly number[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<void> {
  const owed = readPending(db);
  if (owed.length === 0 && opts.changedIds.length === 0) return;
  const fileIds = [...new Set([...owed, ...opts.changedIds])];
  setSetting(db, AUTO_TAG_PENDING_KEY, JSON.stringify(fileIds));
  const { completed } = await applyAutoTags(db, { ...opts, fileIds });
  if (completed) setSetting(db, AUTO_TAG_PENDING_KEY, "[]");
}

/** Forget what is owed — the feature was turned off, so nothing is. */
export function clearAutoTagPending(db: DB): void {
  if (getSetting(db, AUTO_TAG_PENDING_KEY) !== null) {
    setSetting(db, AUTO_TAG_PENDING_KEY, "[]");
  }
}

/** What the auto-tagging screen loads from one workspace. */
export function autoTagFiles(
  db: DB,
  workspaceId: string,
  limit: number = MAX_AUTO_TAG_FILES,
): { files: AutoTagFile[]; total: number; existingTags: string[] } {
  const rows = db
    .prepare(
      `SELECT f.id, f.rel_path, f.meta_key,
              (SELECT json_group_array(t.name)
                 FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id
                WHERE mt.meta_key = f.meta_key AND t.namespace = '') AS tags
         FROM files f WHERE f.deleted_at IS NULL ORDER BY f.id LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    rel_path: string;
    meta_key: string;
    tags: string;
  }[];
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NULL")
      .get() as { n: number }
  ).n;
  const existingTags = db
    .prepare("SELECT name FROM tags WHERE namespace = ''")
    .pluck()
    .all() as string[];
  return {
    files: rows.map((row) => ({
      workspaceId,
      id: row.id,
      name: fileNameOf(row.rel_path).normalize("NFC"),
      metaKey: row.meta_key,
      tags: [...new Set(JSON.parse(row.tags) as string[])],
    })),
    total,
    existingTags,
  };
}
