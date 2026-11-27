// Reads the EXIF of the photos whose `files.exif` is still NULL (#701): those
// scanned before EXIF was read, and those whose read failed. A file whose size
// and mtime did not change never reaches the thumbnail pass again, so this is
// how an existing library gets its capture dates.
//
// Progress lives in the rows themselves rather than in a settings version:
// a read photo holds its JSON or '{}', so a pass cut short resumes where it
// stopped, and a photo that could not be read (a share that dropped out) is
// tried again by the next scan instead of being left out for good.
import type { DB } from "./db.js";
import {
  AUTO_META_SOURCE,
  applyDerivedTagsByKey,
  autoMetaTagsFor,
  derivedTagIdResolver,
} from "./autoMetaTags.js";
import { pool } from "./concurrency.js";
import { readExif, type ExifResult } from "./exif.js";
import { SCAN_POOL_WIDTH } from "./mediaConcurrency.js";

const CHUNK = 512;

interface PendingRow {
  id: number;
  meta_key: string;
  abs_path: string;
  rel_path: string;
  kind: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
}

/** Returns the number of photos written. */
export async function backfillExif(
  db: DB,
  opts: {
    /** Rows not to read now (the walk could not reach them). */
    skip?: (relPath: string) => boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<number> {
  const { skip, signal, onProgress } = opts;
  // The WHERE of idx_files_exif_pending, so both statements use it.
  const PENDING = "exif IS NULL AND kind = 'image' AND deleted_at IS NULL";
  const total = db
    .prepare(`SELECT COUNT(*) FROM files WHERE ${PENDING}`)
    .pluck()
    .get() as number;
  if (total === 0) return 0;

  // Keyset paging, as backfillDerivedTags: each chunk commits, which an open
  // cursor on the same connection would refuse.
  const page = db.prepare(
    `SELECT id, meta_key, abs_path, rel_path, kind, width, height, duration, codec
       FROM files WHERE ${PENDING} AND id > ? ORDER BY id LIMIT ?`,
  );
  const write = db.prepare(
    "UPDATE files SET exif = ?, captured_at = COALESCE(?, captured_at) WHERE id = ?",
  );
  const persist = db.transaction(
    (read: { row: PendingRow; result: ExifResult }[]) => {
      // Per transaction, as derivedTagIdResolver asks.
      const tagIdOf = derivedTagIdResolver(db);
      for (const { row, result } of read) {
        if (result.exif === null) continue;
        write.run(JSON.stringify(result.exif), result.capturedAt, row.id);
        applyDerivedTagsByKey(
          db,
          row.meta_key,
          AUTO_META_SOURCE,
          autoMetaTagsFor({ ...row, exif: result.exif }),
          tagIdOf,
        );
      }
    },
  );

  let lastId = 0;
  let done = 0;
  let written = 0;
  for (;;) {
    if (signal?.aborted) break;
    const rows = page.all(lastId, CHUNK) as PendingRow[];
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    const read: { row: PendingRow; result: ExifResult }[] = [];
    await pool(
      rows.filter((r) => !skip?.(r.rel_path)),
      SCAN_POOL_WIDTH,
      async (row) => {
        read.push({ row, result: await readExif(row.abs_path) });
      },
      signal,
    );
    persist(read);
    written += read.filter((r) => r.result.exif !== null).length;
    done += rows.length;
    onProgress?.(done, total);
  }
  return written;
}
