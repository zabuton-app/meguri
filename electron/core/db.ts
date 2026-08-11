// SQLite (better-sqlite3). Schema definition and connection.
import Database from "better-sqlite3";

export type DB = Database.Database;

// Trigram tokenizer enables substring matching (mid-word and CJK), which the default
// unicode61 tokenizer cannot do. Shared between CORE_DDL and the rebuild in
// migrateFtsToTrigram so the two can never drift apart.
const FTS_DDL =
  "CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(rel_path, tags_text, tokenize='trigram')";

/**
 * The (rowid, rel_path, tags_text) projection every FTS writer must agree on —
 * this constant, syncFts() and tagsText() in tags.ts must produce the same set
 * of names — the order within tags_text is not load-bearing (the tokenizer
 * indexes trigrams, not positions). DISTINCT collapses the same tag attached
 * via multiple sources; duplicates carry no extra search signal.
 *
 * Only user-owned tags (namespace = '') are indexed. The tokenizer is trigram,
 * so indexing a generated tag like `dur:long` would make a plain search for
 * "long" return every long video — and likewise for "short", "square",
 * "h264"… Generated tags stay reachable through the explicit `tag:` directive
 * (see buildSearchTerms in queries/files.ts) and through the structured
 * SearchQuery.tags[] filter, neither of which goes through FTS.
 *
 * Callers append their own scope to the trailing WHERE clause.
 */
const FTS_ROW_SELECT = `
  SELECT f.id, f.rel_path,
         COALESCE((SELECT group_concat(name, ' ') FROM
           (SELECT DISTINCT t.name AS name
            FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id
            WHERE mt.meta_key = f.meta_key AND t.namespace = ''
            ORDER BY name)), '')
  FROM files f WHERE f.deleted_at IS NULL`;

/** Chunk size for meta_key batches passed to resyncFtsForKeys as one JSON array. */
const FTS_RESYNC_CHUNK = 5000;

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
  ext TEXT, size INTEGER, mtime INTEGER, btime INTEGER, inode INTEGER, content_hash TEXT,
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
-- Manual-tag autocomplete only offers user-owned tags, so listTagNames filters on
-- namespace = ''. A partial index over the same expression keeps that prefix range
-- search covering, which the plain index above cannot do once the predicate is added.
CREATE INDEX IF NOT EXISTS idx_tags_manual_name ON tags(name COLLATE NOCASE) WHERE namespace = '';

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

${FTS_DDL};
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
  migrateFtsToTrigram(db);
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
  // Filesystem creation time (birthtime), NULL where the filesystem doesn't
  // provide it. The index lives here (not in CORE_DDL) because on pre-existing
  // DBs the column only exists after this ALTER runs.
  if (!hasColumn(db, "files", "btime")) {
    db.exec("ALTER TABLE files ADD COLUMN btime INTEGER");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_btime ON files(btime)");
  // Mirrors idx_files_alive_captured: drives sort=btime in its default DESC
  // direction (the leading expression matches the NULLs-last ORDER BY term).
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_files_alive_btime ON files((btime IS NULL), btime DESC, id) WHERE deleted_at IS NULL",
  );
}

/**
 * Rebuild every FTS row from scratch. Rows already removed from the index
 * (deleted_at set) are not re-added, preserving deleteFromIndex's invariant.
 * Caller supplies the transaction.
 */
export function rebuildFtsAll(db: DB): void {
  db.exec("DELETE FROM files_fts");
  db.exec(
    `INSERT INTO files_fts (rowid, rel_path, tags_text) ${FTS_ROW_SELECT}`,
  );
}

/**
 * Re-index only the files behind the given meta_keys. Used after a tag-catalog
 * mutation (rename / merge / delete) and after the derived-tag backfill, where
 * looping syncFts() per file would mean one delete+insert pair per row plus a
 * meta_key -> file id round trip. Keys are passed as a single JSON array bound
 * to one placeholder (as elsewhere) to stay clear of SQLITE_MAX_VARIABLE_NUMBER.
 */
export function resyncFtsForKeys(db: DB, metaKeys: string[]): void {
  if (metaKeys.length === 0) return;
  // The delete deliberately ignores deleted_at while the insert honours it: a key
  // whose file has since been soft-deleted must lose its stale row, not keep it.
  const del = db.prepare(
    `DELETE FROM files_fts WHERE rowid IN
       (SELECT id FROM files WHERE meta_key IN (SELECT value FROM json_each(?)))`,
  );
  const ins = db.prepare(
    `INSERT INTO files_fts (rowid, rel_path, tags_text)
     ${FTS_ROW_SELECT} AND f.meta_key IN (SELECT value FROM json_each(?))`,
  );
  for (let i = 0; i < metaKeys.length; i += FTS_RESYNC_CHUNK) {
    const chunk = JSON.stringify(metaKeys.slice(i, i + FTS_RESYNC_CHUNK));
    del.run(chunk);
    ins.run(chunk);
  }
}

/** Versionless idempotent migration: DBs created before the trigram switch still carry
 *  a unicode61 files_fts (CREATE VIRTUAL TABLE IF NOT EXISTS leaves it alone), so the
 *  tokenizer is detected from the stored DDL and the table rebuilt once. files_fts is
 *  fully derived data (rel_path from files, tags_text from meta_tags), so dropping it
 *  loses nothing; all user-curated metadata is keyed by meta_key and unaffected. */
function migrateFtsToTrigram(db: DB): void {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files_fts'",
    )
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("trigram")) return;
  db.transaction(() => {
    db.exec("DROP TABLE files_fts");
    db.exec(FTS_DDL);
    rebuildFtsAll(db);
  })();
}

/**
 * Open an existing workspace DB read-only (no DDL, no PRAGMA writes). Used by
 * the query worker: WAL mode allows any number of readers alongside the main
 * process's single writer, and a read-only handle can never take the write
 * lock or mutate schema. Throws if the file does not exist. Schema migrations
 * (backfillColumns / migrateFtsToTrigram) are assumed to have already run via
 * the main process's openDb before any read-only handle is opened.
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
