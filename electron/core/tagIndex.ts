// The bookkeeping of a workspace's keyword index (files_fts.tags_text) against
// the library's tag change log (`lib.tag_changes`), for the writes that change
// tags (tags.ts, tagAdmin.ts, autoTag.ts) and the catch-up in library.ts.
//
// Kept apart from library.ts so the query worker can reach it: tags.ts is in
// the worker's import graph (queries → files → tags), and library.ts imports
// the electron-log logger, which needs the electron module a worker thread
// does not have. Importing it there crashed the worker on every start, so
// every list query ran on the main thread. Nothing here may log.
import { resyncFtsForKeys, usesOwnMetadata, type DB } from "./db.js";
import { getSetting, setSetting } from "./queries/settings.js";

/**
 * Workspace setting: the last `lib.tag_changes` seq this workspace's
 * files_fts.tags_text reflects. Unset until the index is first built from the
 * library.
 */
export const FTS_TAG_SEQ_KEY = "fts_tag_seq";

/** The last seq `lib.tag_changes` handed out, rows trimmed or not; 0 before the first. */
export function latestTagChange(db: DB): number {
  const row = db
    .prepare("SELECT seq FROM lib.sqlite_sequence WHERE name = 'tag_changes'")
    .get() as { seq: number } | undefined;
  return row?.seq ?? 0;
}

/** The FTS_TAG_SEQ_KEY this workspace has recorded, or null if none (or unreadable). */
export function tagIndexSeq(db: DB): number | null {
  const stored = getSetting(db, FTS_TAG_SEQ_KEY);
  const seq = stored === null ? NaN : Number(stored);
  return Number.isSafeInteger(seq) ? seq : null;
}

/**
 * Re-index the files behind `metaKeys` after a tag write that changed them,
 * and record the index as current when those keys are all the log holds past
 * it: the write's own changes, so catchUpTagIndex (syncTagIndexes after every
 * write) does not apply them a second time, which for a large write would
 * mean rebuilding the whole index. Caller supplies the transaction, the one
 * the write ran in.
 */
export function resyncTagIndexForKeys(
  db: DB,
  metaKeys: readonly string[],
): void {
  resyncFtsForKeys(db, [...metaKeys]);
  if (usesOwnMetadata(db)) return;
  const seen = tagIndexSeq(db);
  const latest = latestTagChange(db);
  if (seen === null || seen >= latest) return;
  const { oldest } = db
    .prepare("SELECT MIN(seq) AS oldest FROM lib.tag_changes")
    .get() as { oldest: number | null };
  // Rows the index has not applied are gone from the log: only a rebuild knows.
  if (oldest === null || oldest > seen + 1) return;
  const other = db
    .prepare(
      `SELECT 1 FROM lib.tag_changes WHERE seq > ?
         AND meta_key NOT IN (SELECT value FROM json_each(?)) LIMIT 1`,
    )
    .get(seen, JSON.stringify(metaKeys));
  if (!other) setSetting(db, FTS_TAG_SEQ_KEY, String(latest));
}
