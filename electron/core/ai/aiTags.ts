// Writes zero-shot results into meta_tags under the `ai` namespace / AI source.
// Kept free of Electron imports so the core tests can exercise it directly.
import { createHash } from "node:crypto";
import type { DB } from "../db.js";
import { getSetting, setSetting } from "../queries/settings.js";
import { upsertTag } from "../tags.js";
import { AI_TAG_SOURCE } from "../../../shared/tags.js";
import type { ScoredTag } from "./zeroShot.js";

/**
 * Replace the AI tags of one meta_key with `desired`, as a diff so a re-run
 * over an unchanged library writes nothing. Scores are compared at 3 decimals:
 * the UI shows no finer, and float noise between runs must not churn the WAL.
 */
export function applyScoredTagsByKey(
  db: DB,
  metaKey: string,
  desired: ScoredTag[],
): boolean {
  const wanted = new Map<number, number>();
  for (const tag of desired) {
    // Same guard as applyDerivedTagsByKey, and for the same reason: the FTS
    // projection indexes namespace = '' only, so a pipeline-written tag without
    // one would rot tags_text silently — a search would simply start missing
    // rows, with nothing to trace it back to.
    if (!tag.namespace) {
      throw new Error(`derived tag must be namespaced: ${tag.name}`);
    }
    wanted.set(
      upsertTag(db, tag.namespace, tag.name),
      Math.round(tag.score * 1000) / 1000,
    );
  }
  const current = db
    .prepare(
      "SELECT tag_id AS tagId, score FROM meta_tags WHERE meta_key = ? AND source = ?",
    )
    .all(metaKey, AI_TAG_SOURCE) as { tagId: number; score: number | null }[];
  if (
    current.length === wanted.size &&
    current.every((c) => wanted.get(c.tagId) === c.score)
  ) {
    return false;
  }
  db.prepare("DELETE FROM meta_tags WHERE meta_key = ? AND source = ?").run(
    metaKey,
    AI_TAG_SOURCE,
  );
  const insert = db.prepare(
    "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, ?, ?)",
  );
  for (const [tagId, score] of wanted)
    insert.run(metaKey, tagId, AI_TAG_SOURCE, score);
  return true;
}

/**
 * Remove every AI tag in one workspace.
 *
 * `meta_tags` records the source of a tag but not the model behind it, so tags
 * from a model that is no longer selected are indistinguishable from the current
 * one's. Switching models therefore clears them rather than leaving rows nobody
 * can attribute; the vectors, which *are* keyed by model, are left alone.
 *
 * No FTS resync: the projection indexes unnamespaced tags only, and every AI tag
 * is namespaced.
 */
export function clearAiTags(db: DB): number {
  return db.prepare("DELETE FROM meta_tags WHERE source = ?").run(AI_TAG_SOURCE)
    .changes;
}

/**
 * Identity of the settings a re-tag pass was run with. Tags are a snapshot
 * computed from stored vectors, so editing the vocabulary or the threshold does
 * not change them until the pass is re-run — and comparing this against the
 * stored one is how the UI knows it still has to be.
 *
 * The model belongs in it too: the same words scored by a different model are
 * different tags.
 */
export function aiTagSignature(
  modelId: string,
  vocabulary: readonly string[],
  threshold: number,
): string {
  return createHash("sha1")
    .update([modelId, threshold.toFixed(4), ...vocabulary].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

/** Per-workspace key holding the signature of the last completed re-tag pass. */
export const AI_TAG_SIGNATURE_KEY = "ai_tag_signature";

export function retagSignature(db: DB): string | null {
  return getSetting(db, AI_TAG_SIGNATURE_KEY);
}

/** Whether this workspace's tags were made with something other than `signature`. */
export function needsRetag(db: DB, signature: string): boolean {
  return retagSignature(db) !== signature;
}

export function setRetagSignature(db: DB, signature: string): void {
  setSetting(db, AI_TAG_SIGNATURE_KEY, signature);
}

/** Clear the mark, so the next check reports the tags as out of date. */
export function clearRetagSignature(db: DB): void {
  setSetting(db, AI_TAG_SIGNATURE_KEY, "");
}
