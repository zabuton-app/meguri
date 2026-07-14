// Scene bookmarks (per-file timestamped marks). Scoped to meta_key so they survive
// re-scans even when the underlying files.id changes.
import type { DB } from "../db.js";
import { nowUnix } from "../db.js";
import { metaKeyOf } from "../tags.js";
import type { SceneBookmark } from "../types.js";

// Treat two bookmarks within this many seconds as the same instant. Used to dedupe
// "Add bookmark" presses near an existing mark. Mirrors BOOKMARK_NEAR_EPS in
// src/lib/bookmarks.ts (the UI uses the same value to highlight the active mark) — keep in sync.
const BOOKMARK_NEAR_EPS = 2;

export function listBookmarksByMetaKey(
  db: DB,
  metaKey: string,
): SceneBookmark[] {
  return db
    .prepare(
      "SELECT id, sec, created_at AS createdAt FROM scene_bookmarks WHERE meta_key = ? ORDER BY sec ASC, id ASC",
    )
    .all(metaKey) as SceneBookmark[];
}

export function listBookmarks(db: DB, fileId: number): SceneBookmark[] {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return [];
  return listBookmarksByMetaKey(db, metaKey);
}

/**
 * Add a bookmark at `sec` for the file. Dedupes: if a bookmark already exists within
 * BOOKMARK_NEAR_EPS seconds, returns it instead of inserting a duplicate. The
 * lookup + insert run in a transaction so a concurrent caller can't race the dedupe.
 */
export function addBookmark(
  db: DB,
  fileId: number,
  sec: number,
): SceneBookmark | null {
  if (!Number.isFinite(sec)) return null;
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return null;
  const at = Math.max(0, sec);
  return db.transaction(() => {
    // Any row within the dedupe window is good enough — we don't need the nearest,
    // so we skip an ORDER BY that SQLite can't satisfy from the (meta_key) index.
    const existing = db
      .prepare(
        "SELECT id, sec, created_at AS createdAt FROM scene_bookmarks WHERE meta_key = ? AND ABS(sec - ?) <= ? LIMIT 1",
      )
      .get(metaKey, at, BOOKMARK_NEAR_EPS) as SceneBookmark | undefined;
    if (existing) return existing;
    const createdAt = nowUnix();
    const info = db
      .prepare(
        "INSERT INTO scene_bookmarks (meta_key, sec, created_at) VALUES (?, ?, ?)",
      )
      .run(metaKey, at, createdAt);
    return { id: Number(info.lastInsertRowid), sec: at, createdAt };
  })();
}

/** Remove a bookmark by id, scoped to the file's meta_key so callers can't delete cross-file rows. */
export function removeBookmark(
  db: DB,
  fileId: number,
  bookmarkId: number,
): void {
  const metaKey = metaKeyOf(db, fileId);
  if (!metaKey) return;
  db.prepare("DELETE FROM scene_bookmarks WHERE id = ? AND meta_key = ?").run(
    bookmarkId,
    metaKey,
  );
}
