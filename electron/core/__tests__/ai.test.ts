// AI layer, everything that runs without a model: zero-shot math, the
// embedding table, the tag applier, and the preprocessing helpers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { l2Normalize, rgbToTensor, sampleTimes } from "../ai/clip.js";
import {
  allEmbeddings,
  countPending,
  dot,
  embeddingOf,
  fileIdsForKeys,
  loadEmbeddingMatrix,
  metaKeysForIds,
  pendingFiles,
  purgeMismatchedDims,
  topK,
  topKMatrix,
  upsertEmbedding,
} from "../ai/embeddings.js";
import { applyScoredTagsByKey } from "../ai/aiTags.js";
import { classify, normalizeVocabulary, promptFor } from "../ai/zeroShot.js";
import { fileTags, metaKeyOf } from "../tags.js";
import {
  AI_TAG_NAMESPACE,
  AI_TAG_SOURCE,
  isReservedTagName,
  parseQualifiedTagName,
} from "../../../shared/tags.js";
import { insertFile, newDb } from "./helpers.js";

function vec(...xs: number[]): Float32Array {
  return l2Normalize(new Float32Array(xs));
}

describe("zero-shot classification", () => {
  const vocab = [
    { entry: "cat", vec: vec(1, 0, 0) },
    { entry: "dog", vec: vec(0, 1, 0) },
    { entry: "car", vec: vec(0, 0, 1) },
  ];

  it("returns the entries above the threshold, best first", () => {
    const image = vec(1, 0.98, 0);
    const tags = classify(image, vocab, 0.05);
    expect(tags.map((t) => t.name)).toEqual(["cat", "dog"]);
    expect(tags[0].namespace).toBe(AI_TAG_NAMESPACE);
    expect(tags[0].score).toBeGreaterThan(tags[1].score);
    // Probabilities over the vocabulary sum to one.
    const all = classify(image, vocab, 0);
    expect(all.reduce((s, t) => s + t.score, 0)).toBeCloseTo(1, 5);
  });

  it("yields nothing for an empty vocabulary or a threshold nobody meets", () => {
    expect(classify(vec(1, 0, 0), [], 0.1)).toEqual([]);
    expect(classify(vec(1, 1, 1), vocab, 0.9)).toEqual([]);
  });

  it("wraps entries in a caption prompt", () => {
    expect(promptFor("a cat")).toBe("a photo of a cat");
  });

  it("normalizes the vocabulary: trims, dedupes case-insensitively, drops colons", () => {
    expect(
      normalizeVocabulary([" Cat ", "cat", "", "dog:big", "  dog  big "]),
    ).toEqual(["Cat", "dog big"]);
  });
});

describe("shared tag contract for the ai namespace", () => {
  it("reserves the namespace for the pipeline and splits it on parse", () => {
    expect(isReservedTagName("ai:cat")).toBe(true);
    expect(parseQualifiedTagName("ai:cat")).toEqual({
      namespace: "ai",
      name: "cat",
    });
    expect(parseQualifiedTagName("todo:later")).toEqual({
      namespace: "",
      name: "todo:later",
    });
  });
});

describe("preprocessing helpers", () => {
  it("converts packed rgb24 to normalized planar CHW", () => {
    const p = {
      size: 2,
      mean: [0.5, 0.5, 0.5] as [number, number, number],
      std: [0.5, 0.5, 0.5] as [number, number, number],
    };
    // 2x2 pixels, each (255, 0, 128)
    const rgb = new Uint8Array([
      255, 0, 128, 255, 0, 128, 255, 0, 128, 255, 0, 128,
    ]);
    const t = rgbToTensor(rgb, p);
    expect(t.length).toBe(12);
    expect(t[0]).toBeCloseTo(1); // R plane
    expect(t[4]).toBeCloseTo(-1); // G plane
    expect(t[8]).toBeCloseTo(128 / 255 / 0.5 - 1); // B plane
  });

  it("rejects a short buffer", () => {
    expect(() =>
      rgbToTensor(new Uint8Array(3), {
        size: 2,
        mean: [0, 0, 0],
        std: [1, 1, 1],
      }),
    ).toThrow();
  });

  it("samples evenly inside the middle 90% of a video", () => {
    const times = sampleTimes(100, 4);
    expect(times).toHaveLength(4);
    expect(times[0]).toBeGreaterThan(5);
    expect(times[3]).toBeLessThan(95);
    expect(times[1] - times[0]).toBeCloseTo(times[2] - times[1]);
    expect(sampleTimes(0)).toEqual([0]);
    // Never more samples than whole seconds.
    expect(sampleTimes(2, 6)).toHaveLength(2);
  });

  it("l2-normalizes and tolerates the zero vector", () => {
    expect(dot(vec(3, 4), vec(3, 4))).toBeCloseTo(1);
    expect(Array.from(l2Normalize(new Float32Array([0, 0])))).toEqual([0, 0]);
  });

  it("refuses to score vectors of different widths", () => {
    // Two models stored under one id is the only way this happens, and a score
    // over the shared prefix would look perfectly reasonable.
    expect(() => dot(vec(1, 0), vec(1, 0, 0))).toThrow(/width mismatch/);
  });
});

describe("embedding table", () => {
  let db: DB;
  let rootId: number;
  const MODEL = "test-model";

  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  function ready(id: number): void {
    db.prepare("UPDATE files SET thumb_status = 'done' WHERE id = ?").run(id);
  }

  it("lists only scanned files without a vector, and counts them", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4", duration: 10 });
    const b = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    const c = insertFile(db, rootId, { relPath: "c.jpg", kind: "image" });
    ready(a);
    ready(b);
    // c stays pending (no thumbnail yet): not offered for embedding.
    expect(pendingFiles(db, MODEL).map((f) => f.id)).toEqual([a, b]);
    expect(countPending(db, MODEL)).toBe(2);

    upsertEmbedding(db, metaKeyOf(db, a)!, MODEL, vec(1, 0));
    expect(pendingFiles(db, MODEL).map((f) => f.id)).toEqual([b]);
    // Another model starts from scratch.
    expect(countPending(db, "other")).toBe(2);
    void c;
  });

  it("round-trips vectors through the blob and survives a file move", () => {
    const a = insertFile(db, rootId, {
      relPath: "a.jpg",
      kind: "image",
      contentHash: "h1",
    });
    ready(a);
    const key = metaKeyOf(db, a)!;
    upsertEmbedding(db, key, MODEL, vec(0.6, 0.8));
    const back = embeddingOf(db, key, MODEL)!;
    expect(back[0]).toBeCloseTo(0.6);
    expect(back[1]).toBeCloseTo(0.8);

    // Rename: same content hash → same meta_key → vector still found.
    db.prepare("UPDATE files SET rel_path = 'moved.jpg' WHERE id = ?").run(a);
    expect(embeddingOf(db, metaKeyOf(db, a)!, MODEL)).not.toBeNull();
    expect(countPending(db, MODEL)).toBe(0);
  });

  it("upsert replaces the vector for the same key", () => {
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const key = metaKeyOf(db, a)!;
    upsertEmbedding(db, key, MODEL, vec(1, 0));
    upsertEmbedding(db, key, MODEL, vec(0, 1));
    expect(allEmbeddings(db, MODEL)).toHaveLength(1);
    expect(embeddingOf(db, key, MODEL)![1]).toBeCloseTo(1);
  });

  it("allEmbeddings skips vectors whose file is gone, fileIdsForKeys maps keys back", () => {
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const b = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    const ka = metaKeyOf(db, a)!;
    const kb = metaKeyOf(db, b)!;
    upsertEmbedding(db, ka, MODEL, vec(1, 0));
    upsertEmbedding(db, kb, MODEL, vec(0, 1));
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(b);
    expect(allEmbeddings(db, MODEL).map((r) => r.metaKey)).toEqual([ka]);
    const ids = fileIdsForKeys(db, [ka, kb]);
    expect(ids.get(ka)).toEqual([a]);
    expect(ids.has(kb)).toBe(false);
  });

  it("maps a meta_key shared by duplicates back to every copy", () => {
    const a = insertFile(db, rootId, {
      relPath: "a.jpg",
      kind: "image",
      contentHash: "same",
    });
    const b = insertFile(db, rootId, {
      relPath: "copy/a.jpg",
      kind: "image",
      contentHash: "same",
    });
    const key = metaKeyOf(db, a)!;
    expect(metaKeyOf(db, b)).toBe(key);
    expect(fileIdsForKeys(db, [key]).get(key)).toEqual([a, b]);
    expect(metaKeysForIds(db, [b])).toEqual(new Set([key]));
    expect(metaKeysForIds(db, [])).toEqual(new Set());
  });

  it("never counts audio as pending, so the count can reach zero", () => {
    const song = insertFile(db, rootId, { relPath: "a.mp3", kind: "audio" });
    const pic = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    ready(song);
    ready(pic);
    expect(pendingFiles(db, MODEL).map((f) => f.id)).toEqual([pic]);
    expect(countPending(db, MODEL)).toBe(1);
    upsertEmbedding(db, metaKeyOf(db, pic)!, MODEL, vec(1, 0));
    expect(countPending(db, MODEL)).toBe(0);
  });

  it("packs the vectors of alive files into one matrix, in the model's width", () => {
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const b = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    const c = insertFile(db, rootId, { relPath: "c.jpg", kind: "image" });
    const [ka, kb, kc] = [a, b, c].map((id) => metaKeyOf(db, id)!);
    upsertEmbedding(db, ka, MODEL, vec(1, 0));
    upsertEmbedding(db, kb, MODEL, vec(0, 1));
    // A stale vector from a different model in a same-named folder.
    upsertEmbedding(db, kc, MODEL, vec(1, 0, 0));
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(b);

    const m = loadEmbeddingMatrix(db, MODEL, 2);
    expect(m.keys).toEqual([ka]);
    expect(m.mat).toHaveLength(2);
    expect(m.mat[0]).toBeCloseTo(1);
    expect(loadEmbeddingMatrix(db, "other", 2).keys).toEqual([]);
  });

  it("purges vectors whose width no longer matches the model", () => {
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const b = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    ready(a);
    ready(b);
    upsertEmbedding(db, metaKeyOf(db, a)!, MODEL, vec(1, 0));
    upsertEmbedding(db, metaKeyOf(db, b)!, MODEL, vec(1, 0, 0));
    expect(countPending(db, MODEL)).toBe(0);

    expect(purgeMismatchedDims(db, MODEL, 2)).toBe(1);
    // The purged file is pending again, so the next run re-embeds it.
    expect(pendingFiles(db, MODEL).map((f) => f.id)).toEqual([b]);
  });

  it("topKMatrix keeps the best k in order, and can leave one row out", () => {
    const m = {
      modelId: MODEL,
      dim: 2,
      keys: ["x", "y", "z", "w"],
      mat: new Float32Array([
        ...vec(1, 0),
        ...vec(0.7, 0.7),
        ...vec(0, 1),
        ...vec(0.9, 0.1),
      ]),
    };
    const q = vec(1, 0.05);
    expect(topKMatrix(q, m, 2).map((s) => s.item)).toEqual(["x", "w"]);
    expect(topKMatrix(q, m, 10).map((s) => s.item)).toEqual([
      "x",
      "w",
      "y",
      "z",
    ]);
    expect(topKMatrix(q, m, 2, { skip: "x" }).map((s) => s.item)).toEqual([
      "w",
      "y",
    ]);
    // A collection's members only: the best of the library does not crowd them out.
    expect(
      topKMatrix(q, m, 2, { allow: new Set(["y", "z"]) }).map((s) => s.item),
    ).toEqual(["y", "z"]);
    expect(topKMatrix(q, m, 0)).toEqual([]);
    // Agrees with the row-by-row ranking it replaces.
    const rows = m.keys.map((item, i) => ({
      item,
      vec: m.mat.subarray(i * 2, (i + 1) * 2),
    }));
    expect(topKMatrix(q, m, 3)).toEqual(topK(q, rows, 3));
    expect(() => topKMatrix(vec(1, 0, 0), m, 1)).toThrow(/width mismatch/);
  });

  it("topK ranks by cosine and honours the limit", () => {
    const rows = [
      { item: "x", vec: vec(1, 0) },
      { item: "y", vec: vec(0.7, 0.7) },
      { item: "z", vec: vec(0, 1) },
    ];
    expect(topK(vec(1, 0.1), rows, 2).map((s) => s.item)).toEqual(["x", "y"]);
    expect(topK(vec(1, 0), rows, 10, 0.5).map((s) => s.item)).toEqual([
      "x",
      "y",
    ]);
  });
});

describe("applyScoredTagsByKey", () => {
  let db: DB;
  let rootId: number;

  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("writes namespaced tags with scores, diffs on re-apply, and leaves manual tags alone", () => {
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const key = metaKeyOf(db, a)!;
    db.prepare("INSERT INTO tags (name, namespace) VALUES ('beach', '')").run();
    db.prepare(
      "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, 1, 'manual', NULL)",
    ).run(key);

    const desired = [
      { namespace: AI_TAG_NAMESPACE, name: "cat", score: 0.81234 },
      { namespace: AI_TAG_NAMESPACE, name: "animal", score: 0.15 },
    ];
    expect(applyScoredTagsByKey(db, key, desired)).toBe(true);
    // Same result (score noise under 1e-3) → no write.
    expect(
      applyScoredTagsByKey(db, key, [
        { ...desired[0], score: 0.81201 },
        desired[1],
      ]),
    ).toBe(false);
    // Dropping one → write.
    expect(applyScoredTagsByKey(db, key, [desired[0]])).toBe(true);

    const tags = fileTags(db, a);
    expect(
      tags.map((t) => `${t.source}:${t.namespace}:${t.name}`).sort(),
    ).toEqual([`${AI_TAG_SOURCE}:ai:cat`, "manual::beach"]);
    expect(tags.find((t) => t.name === "cat")?.score).toBeCloseTo(0.812, 3);
  });
});
