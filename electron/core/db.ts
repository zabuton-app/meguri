// SQLite (better-sqlite3). Schema definition and connection.
import Database from "better-sqlite3";

export type DB = Database.Database;

const CORE_DDL = `
CREATE TABLE IF NOT EXISTS scan_roots (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, path_hash TEXT NOT NULL,
  last_scan_at INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, abs_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video','image')),
  ext TEXT, size INTEGER, mtime INTEGER, inode INTEGER, content_hash TEXT,
  width INTEGER, height INTEGER, duration REAL, codec TEXT, fps REAL, captured_at INTEGER,
  thumb_path TEXT, thumb_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (thumb_status IN ('pending','done','error')),
  deleted_at INTEGER, excluded_at INTEGER, created_at INTEGER NOT NULL, meta TEXT,
  -- Stable identity for metadata, independent of the autoincrement id: content_hash
  -- when available (survives move/rename), else a root-scoped rel_path fallback.
  meta_key TEXT GENERATED ALWAYS AS
    (COALESCE(content_hash, 'p:' || root_id || ':' || rel_path)) VIRTUAL,
  UNIQUE (root_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_id);
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_captured ON files(captured_at);
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_files_thumb_status ON files(thumb_status);
CREATE INDEX IF NOT EXISTS idx_files_excluded ON files(excluded_at);
CREATE INDEX IF NOT EXISTS idx_files_meta_key ON files(meta_key);
-- Partial indexes over live rows: every list/search/count filters on
-- "deleted_at IS NULL", and better-sqlite3 runs synchronously on the main
-- process, so a filesort/full scan here directly blocks UI/IPC/serving.
-- idx_files_alive turns countFiles() into a covering-index scan.
CREATE INDEX IF NOT EXISTS idx_files_alive ON files(deleted_at) WHERE deleted_at IS NULL;
-- Drives sort=name ("ORDER BY rel_path <dir>, id <dir>" scans it forward/backward).
CREATE INDEX IF NOT EXISTS idx_files_alive_rel_path ON files(rel_path, id) WHERE deleted_at IS NULL;
-- Drives sort=captured in its default DESC direction: the leading expression
-- matches the "captured_at IS NULL ASC" NULLs-last term exactly. The ASC
-- direction still filesorts (a reversed scan would put NULLs first).
CREATE INDEX IF NOT EXISTS idx_files_alive_captured ON files((captured_at IS NULL), captured_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT '',
  UNIQUE (namespace, name)
);
-- Tag-name autocomplete uses a prefix LIKE; LIKE is case-insensitive by
-- default, so the range-search optimization needs a NOCASE-collated index.
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

-- Durable, manually-curated metadata keyed by the stable meta_key (not files.id),
-- so it survives rebuilding the files/files_fts tables. Removed only when the whole
-- workspace is deleted (its data directory is wiped).
CREATE TABLE IF NOT EXISTS file_meta (
  meta_key TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_accessed_at INTEGER,
  -- User-chosen thumbnail offset (seconds into the video). NULL means the auto-extracted
  -- representative frame is used. The actual thumbnail bytes still live on disk at
  -- files.thumb_path; this column records "where the frame came from" so a rebuild can
  -- regenerate it deterministically and so the UI can highlight the source scene.
  thumb_offset_sec REAL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_meta_favorite ON file_meta(favorite);
CREATE INDEX IF NOT EXISTS idx_file_meta_accessed ON file_meta(last_accessed_at);

CREATE TABLE IF NOT EXISTS meta_tags (
  meta_key TEXT NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL, score REAL,
  PRIMARY KEY (meta_key, tag_id, source)
);
CREATE INDEX IF NOT EXISTS idx_meta_tags_tag ON meta_tags(tag_id);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY, meta_key TEXT NOT NULL,
  played_at INTEGER NOT NULL, position REAL, via TEXT NOT NULL CHECK (via IN ('browser','external'))
);
CREATE INDEX IF NOT EXISTS idx_play_history_meta ON play_history(meta_key);
CREATE INDEX IF NOT EXISTS idx_play_history_played ON play_history(played_at DESC, id DESC);

-- User-curated scene bookmarks (specific times in a video, distinct from the auto-generated
-- evenly-spaced scenes shown in the player). Keyed by meta_key like file_meta so bookmarks
-- survive file moves/renames once a content_hash is established.
-- No UNIQUE on (meta_key, sec): "no two bookmarks at the same time" is a policy enforced
-- in addBookmark() with a ±BOOKMARK_NEAR_EPS window, which doesn't map to a column constraint.
CREATE TABLE IF NOT EXISTS scene_bookmarks (
  id INTEGER PRIMARY KEY,
  meta_key TEXT NOT NULL,
  sec REAL NOT NULL CHECK (sec >= 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scene_bookmarks_meta ON scene_bookmarks(meta_key);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(rel_path, tags_text);
`;

/** Open the DB and apply PRAGMAs. New tables/columns added after release are reconciled
 *  here so existing on-disk DBs gain them without a separate migration step. */
export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(CORE_DDL);
  backfillColumns(db);
  return db;
}

function hasColumn(db: DB, table: string, column: string): boolean {
  // PRAGMA doesn't accept bound parameters, so the table name has to be interpolated.
  // Validate against a strict identifier whitelist so this can never become an injection
  // vector if a future caller passes external input.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`invalid table name: ${table}`);
  }
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return rows.some((r) => r.name === column);
}

/** Idempotent column additions for tables that pre-date the new column. CREATE TABLE
 *  IF NOT EXISTS leaves existing tables alone, so columns added after first release must
 *  be added explicitly with ALTER. Each step must be safe to run repeatedly. */
function backfillColumns(db: DB): void {
  if (!hasColumn(db, "file_meta", "thumb_offset_sec")) {
    db.exec("ALTER TABLE file_meta ADD COLUMN thumb_offset_sec REAL");
  }
}

/**
 * Open an existing workspace DB read-only (no DDL, no PRAGMA writes). Used by
 * the query worker: WAL mode allows any number of readers alongside the main
 * process's single writer, and a read-only handle can never take the write
 * lock or mutate schema. Throws if the file does not exist.
 */
export function openDbReadonly(file: string): DB {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  // Connection-local (never written to the file): even in WAL mode a reader
  // can hit SQLITE_BUSY around writer checkpoints; retry briefly instead of
  // surfacing an exception to the renderer.
  db.pragma("busy_timeout = 5000");
  return db;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
