// meta_embeddings access + in-memory nearest-neighbour search.
//
// No vector index: a brute-force dot product over every stored vector is a few
// milliseconds for tens of thousands of files, which is the scale of a personal
// library, and it keeps the only native dependency better-sqlite3.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";

export interface EmbeddingRow {
  metaKey: string;
  vec: Float32Array;
}

/** A file the index job still has to embed for `modelId`. */
export interface PendingFile {
  id: number;
  metaKey: string;
  absPath: string;
  kind: string;
  duration: number | null;
}

function toBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function fromBlob(blob: Buffer, dim: number): Float32Array | null {
  // Copy into an aligned buffer: a Buffer slice of the SQLite page is not
  // guaranteed to start on a 4-byte boundary. One memcpy rather than a
  // per-element DataView read — at tens of thousands of rows the difference is
  // the bulk of the time spent loading the index. Little-endian is assumed, as
  // it is by toBlob, which is true of every architecture the app ships for.
  const bytes = dim * 4;
  if (blob.byteLength < bytes) return null;
  const ab = new ArrayBuffer(bytes);
  Buffer.from(ab).set(blob.subarray(0, bytes));
  return new Float32Array(ab);
}

export function upsertEmbedding(
  db: DB,
  metaKey: string,
  modelId: string,
  vec: Float32Array,
): void {
  db.prepare(
    `INSERT INTO meta_embeddings (meta_key, model_id, dim, vec, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(meta_key, model_id) DO UPDATE SET dim = excluded.dim, vec = excluded.vec, created_at = excluded.created_at`,
  ).run(metaKey, modelId, vec.length, toBlob(vec), nowUnix());
}

/**
 * Drop every vector of one model.
 *
 * Model files and vectors live in different places — the models folder is
 * global, the vectors are per-workspace — so removing a model cannot clean up
 * after itself here. The caller owns that: run this over every workspace when a
 * model is removed, or when one is re-imported under an id it already used, or
 * the leftovers are compared against a model that no longer produced them.
 */
export function deleteEmbeddingsForModel(db: DB, modelId: string): number {
  return db
    .prepare("DELETE FROM meta_embeddings WHERE model_id = ?")
    .run(modelId).changes;
}

/** Vectors whose file is gone for good — the sweep that keeps a library of
 *  churning files from carrying its whole history in `meta_embeddings`. */
export function deleteOrphanEmbeddings(db: DB): number {
  return db
    .prepare(
      `DELETE FROM meta_embeddings
        WHERE NOT EXISTS (SELECT 1 FROM files f
                           WHERE f.meta_key = meta_embeddings.meta_key
                             AND f.deleted_at IS NULL)`,
    )
    .run().changes;
}

/** Whether the model has any vector here at all — the question behind "are the
 *  tags out of date", which is meaningless in a workspace it never ran on. */
export function hasEmbeddings(db: DB, modelId: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM meta_embeddings WHERE model_id = ? LIMIT 1")
      .get(modelId) !== undefined
  );
}

/** Alive images and videos with no embedding for the model yet. Files the scan
 *  has not finished (no thumbnail/meta) are left for a later run: their duration
 *  is still unknown. Audio has no picture, so it is never pending — otherwise the
 *  count could never reach zero. */
export function pendingFiles(
  db: DB,
  modelId: string,
  limit = 100_000,
): PendingFile[] {
  return db
    .prepare(
      `SELECT f.id, f.meta_key AS metaKey, f.abs_path AS absPath, f.kind, f.duration
         FROM files f
        WHERE f.deleted_at IS NULL AND f.thumb_status = 'done'
          AND f.kind IN ('video', 'image')
          AND NOT EXISTS (SELECT 1 FROM meta_embeddings e
                           WHERE e.meta_key = f.meta_key AND e.model_id = ?)
        ORDER BY f.id LIMIT ?`,
    )
    .all(modelId, limit) as PendingFile[];
}

export function countPending(db: DB, modelId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM files f
          WHERE f.deleted_at IS NULL AND f.thumb_status = 'done'
            AND f.kind IN ('video', 'image')
            AND NOT EXISTS (SELECT 1 FROM meta_embeddings e
                             WHERE e.meta_key = f.meta_key AND e.model_id = ?)`,
      )
      .get(modelId) as { n: number }
  ).n;
}

/** Every stored vector for the model that still belongs to an alive file. */
export function allEmbeddings(db: DB, modelId: string): EmbeddingRow[] {
  const rows = db
    .prepare(
      `SELECT e.meta_key AS metaKey, e.dim, e.vec
         FROM meta_embeddings e
        WHERE e.model_id = ?
          AND EXISTS (SELECT 1 FROM files f WHERE f.meta_key = e.meta_key AND f.deleted_at IS NULL)`,
    )
    .all(modelId) as { metaKey: string; dim: number; vec: Buffer }[];
  // A truncated blob drops its own row rather than failing the whole load: one
  // unreadable vector must not cost the user every other one.
  const out: EmbeddingRow[] = [];
  for (const r of rows) {
    const vec = fromBlob(r.vec, r.dim);
    if (vec) out.push({ metaKey: r.metaKey, vec });
  }
  return out;
}

export function embeddingOf(
  db: DB,
  metaKey: string,
  modelId: string,
): Float32Array | null {
  const row = db
    .prepare(
      "SELECT dim, vec FROM meta_embeddings WHERE meta_key = ? AND model_id = ?",
    )
    .get(metaKey, modelId) as { dim: number; vec: Buffer } | undefined;
  return row ? fromBlob(row.vec, row.dim) : null;
}

/**
 * Every alive file's vector for one model, packed into a single Float32Array.
 *
 * One contiguous matrix rather than a Float32Array per row: tens of thousands
 * of small typed arrays cost an object header each and a GC walk over all of
 * them, and loading them through `.all()` holds every BLOB Buffer alongside the
 * copies at the peak. Rows are read with `.iterate()` straight into the matrix.
 */
export interface EmbeddingMatrix {
  modelId: string;
  dim: number;
  keys: string[];
  /** `keys.length * dim` values; row i is `mat.subarray(i * dim, (i + 1) * dim)`. */
  mat: Float32Array;
}

export function loadEmbeddingMatrix(
  db: DB,
  modelId: string,
  dim: number,
): EmbeddingMatrix {
  const count = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM meta_embeddings e
          WHERE e.model_id = ? AND e.dim = ?
            AND EXISTS (SELECT 1 FROM files f WHERE f.meta_key = e.meta_key AND f.deleted_at IS NULL)`,
      )
      .get(modelId, dim) as { n: number }
  ).n;
  const mat = new Float32Array(count * dim);
  const bytes = Buffer.from(mat.buffer);
  const keys: string[] = [];
  const iter = db
    .prepare(
      `SELECT e.meta_key AS metaKey, e.vec
         FROM meta_embeddings e
        WHERE e.model_id = ? AND e.dim = ?
          AND EXISTS (SELECT 1 FROM files f WHERE f.meta_key = e.meta_key AND f.deleted_at IS NULL)`,
    )
    .iterate(modelId, dim) as Iterable<{ metaKey: string; vec: Buffer }>;
  for (const r of iter) {
    // Both statements run in autocommit, so a write landing between them could
    // add a row; the matrix is sized by the count and simply stops there.
    if (keys.length >= count) break;
    if (r.vec.byteLength < dim * 4) continue;
    bytes.set(r.vec.subarray(0, dim * 4), keys.length * dim * 4);
    keys.push(r.metaKey);
  }
  return {
    modelId,
    dim,
    keys,
    mat: keys.length === count ? mat : mat.slice(0, keys.length * dim),
  };
}

/**
 * Remove a model's vectors whose width no longer matches the model. They only
 * exist when a different model has been put in a directory of the same name;
 * leaving them would keep those files off the pending list forever while no
 * search could use them.
 */
export function purgeMismatchedDims(
  db: DB,
  modelId: string,
  dim: number,
): number {
  return db
    .prepare("DELETE FROM meta_embeddings WHERE model_id = ? AND dim != ?")
    .run(modelId, dim).changes;
}

/**
 * Top-k rows of a matrix by dot product, best first. Keeps only k candidates
 * as it goes instead of scoring into an array the size of the library and
 * sorting it. `skip` drops one row (the query file itself, for "similar");
 * `allow` limits the candidates to a set of keys (a collection's members).
 */
export function topKMatrix(
  query: Float32Array,
  m: EmbeddingMatrix,
  k: number,
  opts: { skip?: string; allow?: Set<string> } = {},
): Scored<string>[] {
  const { skip, allow } = opts;
  if (query.length !== m.dim) {
    throw new Error(`embedding width mismatch: ${query.length} vs ${m.dim}`);
  }
  const best: Scored<string>[] = [];
  if (k <= 0) return best;
  const { dim, mat, keys } = m;
  for (let r = 0; r < keys.length; r++) {
    if (keys[r] === skip) continue;
    if (allow && !allow.has(keys[r])) continue;
    let s = 0;
    const off = r * dim;
    for (let i = 0; i < dim; i++) s += query[i] * mat[off + i];
    if (best.length === k && s <= best[k - 1].score) continue;
    // Insertion into a sorted array of at most k: k is a page size, not a
    // library size, so this beats a heap on constant factors.
    let at = best.length;
    while (at > 0 && best[at - 1].score < s) at--;
    best.splice(at, 0, { item: keys[r], score: s });
    if (best.length > k) best.pop();
  }
  return best;
}

/**
 * Resolve meta_keys back to the (alive) file ids that carry them. A content hash
 * shared by duplicates maps to every copy, in id order.
 */
export function fileIdsForKeys(
  db: DB,
  metaKeys: string[],
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (metaKeys.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT id, meta_key AS metaKey FROM files
        WHERE deleted_at IS NULL AND meta_key IN (SELECT value FROM json_each(?))
        ORDER BY id`,
    )
    .all(JSON.stringify(metaKeys)) as { id: number; metaKey: string }[];
  for (const r of rows) {
    const ids = out.get(r.metaKey);
    if (ids) ids.push(r.id);
    else out.set(r.metaKey, [r.id]);
  }
  return out;
}

/** The meta_keys of a set of (alive) files — a collection's members, for a search allow-list. */
export function metaKeysForIds(db: DB, ids: number[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(
    db
      .prepare(
        `SELECT meta_key FROM files
          WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
      )
      .pluck()
      .all(JSON.stringify(ids)) as string[],
  );
}

/**
 * Cosine similarity, given L2-normalized inputs.
 *
 * Mismatched widths throw rather than scoring the overlap: vectors of different
 * dimensions only ever meet when two different models have been stored under one
 * id, and silently comparing their first N terms would return a plausible number
 * that means nothing.
 */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`embedding width mismatch: ${a.length} vs ${b.length}`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Top-k by dot product (cosine, given normalized inputs). Stable for ties by input order. */
export function topK<T>(
  query: Float32Array,
  rows: { item: T; vec: Float32Array }[],
  k: number,
  minScore = -Infinity,
): Scored<T>[] {
  const scored: Scored<T>[] = [];
  for (const r of rows) {
    const score = dot(query, r.vec);
    if (score >= minScore) scored.push({ item: r.item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
