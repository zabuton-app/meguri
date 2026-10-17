// One-off correction of video sizes recorded before extractMeta applied the
// stream's rotation and pixel shape. A portrait phone video stored as landscape
// frames plus a rotation was recorded with width and height swapped, and an
// anamorphic one (e.g. 720x1280 frames shown 16:9) at its stored pixel grid.
// The raw ffprobe output kept in `files.meta` carries both, so the rows are
// fixed from it without re-reading any media file.
import type { DB } from "./db.js";
import { probedVideoSize } from "./media.js";
import { getSetting, setSetting } from "./queries/settings.js";

/** Bump to run the correction again over every video. Bump
 *  AUTO_META_RULESET_VERSION with it: the `orient` tags of corrected rows are
 *  only re-derived by that backfill. */
export const VIDEO_DISPLAY_SIZE_VERSION = 1;
export const VIDEO_DISPLAY_SIZE_VERSION_KEY = "video_display_size_version";

const CHUNK = 512;

interface Row {
  id: number;
  width: number | null;
  height: number | null;
  meta: string;
}

export function needsVideoDisplaySizeFix(db: DB): boolean {
  return (
    getSetting(db, VIDEO_DISPLAY_SIZE_VERSION_KEY) !==
    String(VIDEO_DISPLAY_SIZE_VERSION)
  );
}

/**
 * Record videos at their displayed size, and send an anamorphic one's squeezed
 * thumbnail back to be made again.
 *
 * Every video is corrected where it still holds the size
 * ffprobe reports for its frames. Only a row that holds exactly that frame
 * size, on a video whose display size differs from it, is touched, so a run is
 * safe to repeat and leaves rows written by the fixed extractMeta alone.
 *
 * An anamorphic video's thumbnail was scaled by its stored pixel grid, so it
 * is squeezed. Its row goes back to thumb_status 'pending', which the scan
 * then regenerates (and re-probes) with square pixels. Run this before the
 * scan collects its pending files so that happens in the same scan. A row in
 * 'error' is left there, as the scan does.
 *
 * Paged by id and chunked into transactions with a yield between chunks, like
 * `backfillDerivedTags` (autoMetaTags.ts), so a large library neither blocks
 * the main process nor holds an open cursor while writing. The version marker
 * is written only after a complete pass, so an interrupted run repeats on the next scan.
 * Returns the number of rows corrected.
 */
export async function fixVideoDisplaySizes(
  db: DB,
  signal?: AbortSignal,
): Promise<number> {
  const page = db.prepare(
    `SELECT id, width, height, meta FROM files
      WHERE kind = 'video' AND meta IS NOT NULL AND id > ? ORDER BY id LIMIT ?`,
  );
  const update = db.prepare(
    `UPDATE files SET width = ?, height = ?,
       thumb_status = CASE WHEN ? AND thumb_status = 'done' THEN 'pending' ELSE thumb_status END
     WHERE id = ?`,
  );
  const applyChunk = db.transaction((rows: Row[]) => {
    let n = 0;
    for (const row of rows) {
      let raw: unknown;
      try {
        raw = JSON.parse(row.meta);
      } catch {
        continue;
      }
      const size = probedVideoSize(raw);
      if (!size) continue;
      const { frame, display } = size;
      if (
        (display.width !== frame.width || display.height !== frame.height) &&
        row.width === frame.width &&
        row.height === frame.height
      ) {
        update.run(
          display.width,
          display.height,
          size.anamorphic ? 1 : 0,
          row.id,
        );
        n++;
      }
    }
    return n;
  });

  let changed = 0;
  let lastId = 0;
  for (;;) {
    if (signal?.aborted) return changed;
    const rows = page.all(lastId, CHUNK) as Row[];
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    changed += applyChunk(rows);
    await new Promise((r) => setImmediate(r));
  }

  if (signal?.aborted) return changed;
  setSetting(
    db,
    VIDEO_DISPLAY_SIZE_VERSION_KEY,
    String(VIDEO_DISPLAY_SIZE_VERSION),
  );
  return changed;
}
