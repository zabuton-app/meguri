import path from "node:path";
import {
  parsePexelsVideoUrl,
  suggestPexelsSource,
  type SourceReviewRow,
} from "../../../shared/pexelsSource.js";
import type { DB } from "../db.js";
import { folderCondition, folderRange } from "./folderRange.js";

type SourceRow = Omit<
  SourceReviewRow,
  "workspaceId" | "saved" | "suggestion"
> & {
  videoId: string | null;
  url: string | null;
};

const SOURCE_ROWS = `
  SELECT f.id, f.rel_path AS relPath, f.width, f.height, f.meta_key AS metaKey, s.video_id AS videoId, s.url
  FROM files f LEFT JOIN lib.pexels_sources s ON s.meta_key = f.meta_key
  WHERE f.kind = 'video' AND f.deleted_at IS NULL`;

export function previewPexelsSources(
  db: DB,
  workspaceId: string,
  scope: { fileIds: number[] } | { folder: string; limit: number },
): SourceReviewRow[] {
  let rows: SourceRow[];
  if ("fileIds" in scope) {
    // One bound array keeps the query below SQLite's variable limit.
    rows = db
      .prepare(
        `${SOURCE_ROWS} AND f.id IN (SELECT value FROM json_each(?)) ORDER BY f.rel_path`,
      )
      .all(JSON.stringify(scope.fileIds)) as SourceRow[];
  } else {
    const { sql, args } = folderCondition(folderRange(scope.folder), true);
    rows = db
      .prepare(
        `${SOURCE_ROWS}${sql ? " AND " + sql : ""} ORDER BY f.rel_path LIMIT ?`,
      )
      .all(...args, scope.limit) as SourceRow[];
  }
  return rows.map(({ id, relPath, width, height, metaKey, videoId, url }) => ({
    id,
    workspaceId,
    relPath,
    width,
    height,
    metaKey,
    saved: videoId && url ? { videoId, url } : null,
    suggestion: url ? null : suggestPexelsSource(path.basename(relPath)),
  }));
}

interface SourceEdit {
  id: number;
  metaKey: string;
  source: string | null;
}

export function writePexelsSources(
  db: DB,
  edits: SourceEdit[],
  replace: boolean,
): number {
  const current = db.prepare(
    "SELECT 1 FROM files WHERE id = ? AND meta_key = ? AND kind = 'video' AND deleted_at IS NULL",
  );
  const insert = db.prepare(`
    INSERT INTO lib.pexels_sources (meta_key, video_id, url) VALUES (?, ?, ?)
    ON CONFLICT(meta_key) DO ${replace ? "UPDATE SET video_id = excluded.video_id, url = excluded.url" : "NOTHING"}
  `);
  const remove = db.prepare(
    "DELETE FROM lib.pexels_sources WHERE meta_key = ?",
  );
  return db.transaction(() => {
    let changed = 0;
    for (const { id, metaKey, source } of edits) {
      if (!current.get(id, metaKey)) continue;
      if (source) {
        const link = parsePexelsVideoUrl(source);
        if (link)
          changed += insert.run(metaKey, link.videoId, link.url).changes;
      } else if (replace) {
        changed += remove.run(metaKey).changes;
      }
    }
    return changed;
  })();
}
