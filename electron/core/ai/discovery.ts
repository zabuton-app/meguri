// The built-in discovery label set: what "Analyze" scores a file against so
// the answer does not depend on the user's vocabulary. ~1.5k English labels
// (everyday scenes and subjects, COCO objects, ImageNet classes, Places365
// scene categories) — plain text, no model weights, so the "nothing is
// bundled" promise about models still holds.
//
// Text embeddings for the whole set are computed once per model and cached
// both in memory and on disk next to the model (keyed by a hash of the label
// list), since 1.5k prompts take a few seconds on a slow CPU.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClipModel } from "./clip.js";
import { aiCacheDir } from "./modelStore.js";
import { promptFor, type VocabEmbedding } from "./zeroShot.js";
import labels from "./discoveryLabels.json" with { type: "json" };
import { scopedLog } from "../logger.js";

const log = scopedLog("ai:discovery");

export const DISCOVERY_LABELS: readonly string[] = labels;

const LABELS_HASH = createHash("sha1")
  .update(DISCOVERY_LABELS.join("\n"))
  .digest("hex")
  .slice(0, 12);

/** Prompts encoded per text-model run; bounds peak memory of the batch. */
const TEXT_BATCH = 64;

const memory = new Map<string, VocabEmbedding[]>();

function cachePath(modelId: string): string {
  // Keyed by model id: label embeddings from different models are not
  // interchangeable. Lives outside the models folder so deleting a model
  // directory really is all there is to removing a model.
  return path.join(
    aiCacheDir(),
    `discovery-${modelId.replace(/[^\w.-]+/g, "_")}-${LABELS_HASH}.f32`,
  );
}

function readCache(modelId: string, dim: number): VocabEmbedding[] | null {
  try {
    const buf = fs.readFileSync(cachePath(modelId));
    if (buf.length !== DISCOVERY_LABELS.length * dim * 4) return null;
    const all = new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    );
    return DISCOVERY_LABELS.map((entry, i) => ({
      entry,
      vec: all.subarray(i * dim, (i + 1) * dim),
    }));
  } catch {
    return null;
  }
}

function writeCache(
  modelId: string,
  embs: VocabEmbedding[],
  dim: number,
): void {
  try {
    const all = new Float32Array(embs.length * dim);
    embs.forEach((e, i) => all.set(e.vec, i * dim));
    // The cache directory is the app's own, so it may not exist yet.
    fs.mkdirSync(aiCacheDir(), { recursive: true });
    fs.writeFileSync(cachePath(modelId), Buffer.from(all.buffer));
  } catch (e) {
    log.warn("could not write discovery cache:", e);
  }
}

/** Embeddings of every discovery label for the given model. */
export async function discoveryEmbeddings(
  model: ClipModel,
): Promise<VocabEmbedding[]> {
  const hit = memory.get(model.id);
  if (hit) return hit;
  let embs = readCache(model.id, model.dim);
  if (!embs) {
    const t0 = Date.now();
    const vecs: Float32Array[] = [];
    for (let i = 0; i < DISCOVERY_LABELS.length; i += TEXT_BATCH) {
      const batch = DISCOVERY_LABELS.slice(i, i + TEXT_BATCH);
      vecs.push(...(await model.embedTexts(batch.map(promptFor))));
    }
    embs = DISCOVERY_LABELS.map((entry, i) => ({ entry, vec: vecs[i] }));
    log.info(
      `embedded ${embs.length} discovery labels in ${Date.now() - t0}ms`,
    );
    writeCache(model.id, embs, model.dim);
  }
  memory.set(model.id, embs);
  return embs;
}
