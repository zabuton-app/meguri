// Tags derived from metadata the scan already stored on `files` — resolution,
// duration, codec and orientation. No media file is re-read: every input is a
// column, which is what makes the backfill affordable.
//
// The classifier is pure and the applier/backfill are generic over the source,
// so a second derived-tag source only has to supply its own `derive` callback.
import type { DB } from "./db.js";
import { getSetting, setSetting } from "./queries/settings.js";
import { metaKeyOf, upsertTag } from "./tags.js";
import { AUTO_META_SOURCE } from "../../shared/tags.js";

export { AUTO_META_SOURCE };

/**
 * Bump whenever a threshold moves, an alias is added, or the vocabulary changes.
 * The next scan of each workspace re-derives every file; classifications that
 * did not move diff out and cost one indexed read each.
 */
export const AUTO_META_RULESET_VERSION = 1;
export const AUTO_META_VERSION_KEY = "auto_meta_ruleset_version";

export interface DerivedTag {
  namespace: string;
  name: string;
}

export interface AutoMetaInput {
  kind: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
}

/** ffprobe reports several spellings per codec; fold them onto one tag name. */
const CODEC_ALIASES: Record<string, string> = {
  h264: "h264",
  avc: "h264",
  avc1: "h264",
  x264: "h264",
  hevc: "hevc",
  h265: "hevc",
  hvc1: "hevc",
  hev1: "hevc",
  av1: "av1",
  av01: "av1",
  "libaom-av1": "av1",
  vp9: "vp9",
  vp8: "vp8",
  mpeg4: "mpeg4",
  msmpeg4v3: "mpeg4",
  div3: "mpeg4",
  mpeg2video: "mpeg2",
  vc1: "vc1",
  wmv3: "vc1",
  prores: "prores",
};

/** Unknown but plausible codec names are kept as-is; the space is small enough. */
const CODEC_SHAPE = /^[a-z0-9]{2,16}$/;

function positive(n: number | null): n is number {
  return n != null && n > 0;
}

/**
 * Resolution class from the LONGER edge, so a 1080x1920 phone video reads as
 * 1080p rather than sd. Thresholds sit ~5% below each nominal height to catch
 * cinemascope crops and slightly-off encodes.
 */
function resolutionClass(width: number, height: number): string {
  const long = Math.max(width, height);
  if (long >= 3600) return "4k";
  if (long >= 1800) return "1080p";
  if (long >= 1200) return "720p";
  return "sd";
}

function durationClass(duration: number): string {
  if (duration < 60) return "short";
  if (duration <= 1800) return "medium";
  return "long";
}

function codecName(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  const known = CODEC_ALIASES[lower];
  if (known) return known;
  return CODEC_SHAPE.test(lower) ? lower : null;
}

/** 2% tolerance so a 1998x2000 image is square rather than vertical. */
function orientationClass(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.02) return "horizontal";
  if (ratio < 0.98) return "vertical";
  return "square";
}

/**
 * The full ruleset. Pure: no DB, no filesystem, no clock. Never throws — a
 * category whose inputs are unusable simply produces no tag, so an empty array
 * is a valid result.
 */
export function autoMetaTagsFor(input: AutoMetaInput): DerivedTag[] {
  const out: DerivedTag[] = [];
  const isVideo = input.kind === "video";
  const size =
    positive(input.width) && positive(input.height)
      ? { w: input.width, h: input.height }
      : null;

  if (size) {
    out.push({ namespace: "res", name: resolutionClass(size.w, size.h) });
  }
  // Videos only: ffprobe reports stills as ~0.04s single-frame streams, and their
  // codec (mjpeg / png / webp) merely restates the file extension.
  if (isVideo && positive(input.duration)) {
    out.push({ namespace: "dur", name: durationClass(input.duration) });
  }
  if (isVideo && input.codec) {
    const name = codecName(input.codec);
    if (name) out.push({ namespace: "codec", name });
  }
  if (size) {
    out.push({ namespace: "orient", name: orientationClass(size.w, size.h) });
  }
  return out;
}

/**
 * Replace the whole of `source` for one meta_key with `desired`.
 *
 * Implemented as a diff so the steady state writes nothing: a rescan of an
 * unchanged library becomes one indexed read per file and no WAL growth.
 * Returns true only when meta_tags actually changed, which is the caller's
 * signal to re-sync FTS.
 */
export function applyDerivedTagsByKey(
  db: DB,
  metaKey: string,
  source: string,
  desired: DerivedTag[],
): boolean {
  for (const tag of desired) {
    // The FTS projection indexes namespace = '' only, which is why the backfill
    // can skip re-syncing it. A derived source that emitted an unnamespaced tag
    // would rot tags_text silently, so refuse it here rather than find out via a
    // search that quietly misses rows.
    if (!tag.namespace) {
      throw new Error(`derived tag must be namespaced: ${tag.name}`);
    }
  }
  const wanted = new Set(
    desired.map((tag) => upsertTag(db, tag.namespace, tag.name)),
  );
  const current = new Set(
    db
      .prepare("SELECT tag_id FROM meta_tags WHERE meta_key = ? AND source = ?")
      .pluck()
      .all(metaKey, source) as number[],
  );
  if (
    wanted.size === current.size &&
    [...wanted].every((id) => current.has(id))
  ) {
    return false;
  }

  db.prepare("DELETE FROM meta_tags WHERE meta_key = ? AND source = ?").run(
    metaKey,
    source,
  );
  const insert = db.prepare(
    "INSERT INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, ?, NULL)",
  );
  for (const tagId of wanted) insert.run(metaKey, tagId, source);
  return true;
}

/** File-id convenience wrapper used by the scan pipeline. */
export function applyAutoMetaTags(
  db: DB,
  fileId: number,
  input: AutoMetaInput,
): boolean {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return false;
  return applyDerivedTagsByKey(
    db,
    metaKey,
    AUTO_META_SOURCE,
    autoMetaTagsFor(input),
  );
}

/** Row shape the backfill hands to `derive`: the union of what any source could use. */
export interface DerivedTagRow {
  id: number;
  meta_key: string;
  kind: string;
  rel_path: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
}

const BACKFILL_CHUNK = 512;

export function needsAutoMetaBackfill(db: DB): boolean {
  return (
    getSetting(db, AUTO_META_VERSION_KEY) !== String(AUTO_META_RULESET_VERSION)
  );
}

/**
 * Re-derive one source's tags for every alive row, straight from the columns the
 * scan already wrote.
 *
 * Needed because `unchanged` and `moved` files never enter the thumbnail pool —
 * syncFiles leaves their thumb_status alone — so a per-file hook alone would
 * only ever tag files that happened to change.
 *
 * Rows are streamed rather than materialized: a 200k-file library would
 * otherwise put every row in memory on the main process at once. Writes are
 * chunked into transactions, the loop yields to the event loop between chunks,
 * and the version marker is written only after a complete pass — so an
 * interrupted run simply repeats next scan (every already-correct file costing
 * one indexed read and no write).
 *
 * No FTS re-sync: `tags_text` carries only user-owned tags, and a derived source
 * is namespaced by contract, so it cannot change the searchable text.
 */
export async function backfillDerivedTags(
  db: DB,
  opts: {
    source: string;
    versionKey: string;
    version: string;
    derive: (row: DerivedTagRow) => DerivedTag[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<number> {
  const { source, versionKey, version, derive, signal, onProgress } = opts;
  // Counted up front rather than derived from the row set: the rows are streamed,
  // so their number is not known until the pass is over — and progress needs a
  // denominator from the first tick.
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NULL")
      .get() as { n: number }
  ).n;

  const applyChunk = db.transaction((chunk: DerivedTagRow[]) => {
    let n = 0;
    for (const row of chunk) {
      if (applyDerivedTagsByKey(db, row.meta_key, source, derive(row))) n++;
    }
    return n;
  });

  // Keyset paging rather than a single iterate(): better-sqlite3 refuses to write
  // on a connection that has an open cursor ("this database connection is busy
  // executing a query"), and each chunk commits a transaction. Paging by id keeps
  // memory at one chunk while leaving the connection free between pages — which
  // also lets a concurrent tag mutation through during the yield.
  const page = db.prepare(
    `SELECT id, meta_key, kind, rel_path, width, height, duration, codec
       FROM files WHERE deleted_at IS NULL AND id > ? ORDER BY id LIMIT ?`,
  );

  let done = 0;
  let changed = 0;
  let lastId = 0;
  for (;;) {
    if (signal?.aborted) return changed;
    const rows = page.all(lastId, BACKFILL_CHUNK) as DerivedTagRow[];
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    changed += applyChunk(rows);
    done += rows.length;
    onProgress?.(done, total);
    // better-sqlite3 is synchronous, so without this the whole pass would block
    // IPC and media serving for its entire duration.
    await new Promise((r) => setImmediate(r));
  }

  if (signal?.aborted) return changed;
  setSetting(db, versionKey, version);
  return changed;
}

/** The auto-meta instance of {@link backfillDerivedTags}. */
export function backfillAutoMetaTags(
  db: DB,
  opts: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<number> {
  return backfillDerivedTags(db, {
    source: AUTO_META_SOURCE,
    versionKey: AUTO_META_VERSION_KEY,
    version: String(AUTO_META_RULESET_VERSION),
    derive: (row) => autoMetaTagsFor(row),
    ...opts,
  });
}
