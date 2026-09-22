// Zero-shot classification: which vocabulary entries describe an image?
//
// CLIP's recipe — softmax over (logit scale × cosine) against every prompt —
// then keep the entries above the user's threshold. The softmax makes the
// vocabulary compete, so a threshold of 0.3 means "this entry alone explains a
// third of the picture": adding entries to the vocabulary lowers every score,
// which is the expected trade-off and why the threshold is user-tunable.
//
// Pure: no model, no DB. The caller supplies the embeddings.
import { AI_TAG_NAMESPACE } from "../../../shared/tags.js";
import type { DerivedTag } from "../autoMetaTags.js";
import { dot } from "./embeddings.js";

/** OpenAI CLIP's learned logit scale (exp(4.6052) ≈ 100). */
export const LOGIT_SCALE = 100;

/** Prompt template: CLIP was trained on captions, not bare nouns. */
export function promptFor(entry: string): string {
  return `a photo of ${entry}`;
}

export interface VocabEmbedding {
  /** The vocabulary entry as the user typed it (becomes the tag name). */
  entry: string;
  vec: Float32Array;
}

export interface ScoredTag extends DerivedTag {
  score: number;
}

/**
 * Tags for one image embedding. Returns entries whose softmax probability meets
 * `threshold`, best first. An empty vocabulary yields nothing.
 */
export function classify(
  image: Float32Array,
  vocab: VocabEmbedding[],
  threshold: number,
): ScoredTag[] {
  if (vocab.length === 0) return [];
  const logits = vocab.map((v) => LOGIT_SCALE * dot(image, v.vec));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const out: ScoredTag[] = [];
  for (let i = 0; i < vocab.length; i++) {
    const p = exps[i] / sum;
    if (p >= threshold) {
      out.push({ namespace: AI_TAG_NAMESPACE, name: vocab[i].entry, score: p });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Normalize a user-edited vocabulary: trim, drop empties and duplicates
 * (case-insensitively, keeping the first spelling). Entries are tag names, so
 * the ":" that would make one read as a namespaced tag is folded to a space.
 */
export function normalizeVocabulary(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entries) {
    const entry = raw.replace(/:/g, " ").replace(/\s+/g, " ").trim();
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
