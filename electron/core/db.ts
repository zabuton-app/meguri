// SQLite (better-sqlite3). Schema definition and connection.
import Database from "better-sqlite3";
import { tagIdentityKey } from "../../shared/tags.js";

export type DB = Database.Database;

/**
 * Make tagIdentityKey callable from SQL as `tag_key(name)`, so a query matches
 * tag names by the same rule as the code around it. SQLite's own `lower()` and
 * NOCASE stop at ASCII. Connection-local: every handle that runs those queries
 * registers it, and nothing in the schema depends on it, so the file still
 * opens anywhere else.
 */
function registerFunctions(db: DB): void {
  db.function("tag_key", { deterministic: true }, (name: unknown) =>
    typeof name === "string" ? tagIdentityKey(name) : name,
  );
}

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
 * Only user-owned tags (namespace = '') are indexed — the rule the tag_changes
 * triggers in LIB_DDL repeat in their WHEN clauses, so change both together.
 * The tokenizer is trigram,
 * so indexing a generated tag like `dur:long` would make a plain search for
 * "long" return every long video — and likewise for "short", "square",
 * "h264"… Generated tags stay reachable through the explicit `tag:` directive
 * (see buildSearchTerms in queries/files.ts) and through the structured
 * SearchQuery.tags[] filter, neither of which goes through FTS.
 *
 * Callers append their own scope to the trailing WHERE clause.
 *
 * The join order in the subquery is pinned (CROSS JOIN), and callers may pin
 * the index on `files` through `from`. Workspace databases are never ANALYZEd,
 * and without statistics the planner starts the subquery from `tags` — every
 * one of the user's tags, for every file — which went unnoticed while a library
 * had a few dozen of them and takes seconds once it has thousands.
 */
const ftsRowSelect = (from = "files f"): string => `
  SELECT f.id, f.rel_path,
         COALESCE((SELECT group_concat(name, ' ') FROM
           (SELECT DISTINCT t.name AS name
            FROM meta_tags mt CROSS JOIN tags t ON t.id = mt.tag_id
            WHERE mt.meta_key = f.meta_key AND t.namespace = ''
            ORDER BY name)), '')
  FROM ${from} WHERE f.deleted_at IS NULL`;
const FTS_ROW_SELECT = ftsRowSelect();

/** Chunk size for meta_key batches passed to resyncFtsForKeys as one JSON array. */
const FTS_RESYNC_CHUNK = 5000;

/** The meta_key expression. migrateFilesTable looks for it in the stored DDL. */
const META_KEY_EXPR = "COALESCE(content_hash, 'p:' || abs_path)";

/** The meta_key of a file without a hash, as built in TypeScript (see META_KEY_EXPR). */
export function pathMetaKey(absPath: string): string {
  return `p:${absPath}`;
}

// Shared between CORE_DDL and the rebuild in migrateFilesTable so the two can never
// drift apart (same rationale as FTS_DDL above).
const FILES_DDL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, abs_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video','image','audio')),
  ext TEXT, size INTEGER, mtime INTEGER, btime INTEGER, inode INTEGER, content_hash TEXT,
  width INTEGER, height INTEGER, duration REAL, codec TEXT, fps REAL, captured_at INTEGER,
  thumb_path TEXT, thumb_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (thumb_status IN ('pending','done','error')),
  deleted_at INTEGER, excluded_at INTEGER, created_at INTEGER NOT NULL, meta TEXT,
  -- Stable identity for metadata, independent of the autoincrement id: content_hash
  -- when available (survives move/rename), else the absolute path. The fallback
  -- has to be unique across workspaces, not just within this database, and a
  -- generated column can only read its own row — so no workspace id, but the
  -- absolute path, which two workspaces share only for the same file.
  meta_key TEXT GENERATED ALWAYS AS
    (${META_KEY_EXPR}) VIRTUAL,
  UNIQUE (root_id, rel_path)
)`;

const CORE_DDL = `
CREATE TABLE IF NOT EXISTS scan_roots (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, path_hash TEXT NOT NULL,
  last_scan_at INTEGER, created_at INTEGER NOT NULL
);

${FILES_DDL};
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

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

${FTS_DDL};
`;

/**
 * The database shared by every workspace (`<userData>/library.sqlite`), attached
 * to each workspace connection as `lib`: user-curated metadata, keyed by
 * meta_key. Every name carries `lib.`, because an unqualified CREATE lands in
 * `main`. Queries elsewhere leave the schema out: SQLite resolves an unqualified
 * table in `main` first, so a workspace that still holds its own copies (one not
 * migrated yet, see library.ts) keeps using them, and one that does not reaches
 * these.
 */
const LIB_DDL = `
CREATE TABLE IF NOT EXISTS lib.tags (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT '',
  UNIQUE (namespace, name)
);
-- Tag-name autocomplete uses a prefix LIKE; LIKE is case-insensitive by
-- default, so the range-search optimization needs a NOCASE-collated index.
CREATE INDEX IF NOT EXISTS lib.idx_tags_name ON tags(name COLLATE NOCASE);
-- Manual-tag autocomplete only offers user-owned tags, so listTagNames filters on
-- namespace = ''. A partial index over the same expression keeps that prefix range
-- search covering, which the plain index above cannot do once the predicate is added.
CREATE INDEX IF NOT EXISTS lib.idx_tags_manual_name ON tags(name COLLATE NOCASE) WHERE namespace = '';

-- Durable, manually-curated metadata keyed by the stable meta_key (not files.id),
-- so it survives rebuilding the files/files_fts tables, moving a file to another
-- workspace, and removing a workspace and adding it again.
CREATE TABLE IF NOT EXISTS lib.file_meta (
  meta_key TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_accessed_at INTEGER,
  -- User-chosen thumbnail offset (seconds into the video). NULL means the auto-extracted
  -- representative frame is used. The actual thumbnail bytes still live on disk at
  -- files.thumb_path; this column records "where the frame came from" so a rebuild can
  -- regenerate it deterministically and so the UI can highlight the source scene.
  thumb_offset_sec REAL,
  -- Where playback was last stopped (seconds). NULL when there is nothing to
  -- resume: never played, played to the end, or barely begun (shared/resume.ts).
  resume_position REAL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lib.idx_file_meta_favorite ON file_meta(favorite);
CREATE INDEX IF NOT EXISTS lib.idx_file_meta_accessed ON file_meta(last_accessed_at);
-- Drives the "In progress" filter (see appendSearchConditions): only a
-- handful of files are ever part-way through, so the filter starts from
-- them rather than scanning every file for a meta row that has one.
CREATE INDEX IF NOT EXISTS lib.idx_file_meta_resume ON file_meta(meta_key) WHERE resume_position IS NOT NULL;

CREATE TABLE IF NOT EXISTS lib.meta_tags (
  meta_key TEXT NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL, score REAL,
  PRIMARY KEY (meta_key, tag_id, source)
);
CREATE INDEX IF NOT EXISTS lib.idx_meta_tags_tag ON meta_tags(tag_id);

CREATE TABLE IF NOT EXISTS lib.play_history (
  id INTEGER PRIMARY KEY, meta_key TEXT NOT NULL,
  played_at INTEGER NOT NULL, position REAL, via TEXT NOT NULL CHECK (via IN ('browser','external'))
);
-- (meta_key, played_at, id): a file's events in timeline order, which also lets
-- a workspace collect its own events without streaming every workspace's
-- (listPlayHistory).
DROP INDEX IF EXISTS lib.idx_play_history_meta;
CREATE INDEX IF NOT EXISTS lib.idx_play_history_meta_played ON play_history(meta_key, played_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS lib.idx_play_history_played ON play_history(played_at DESC, id DESC);

-- User-curated scene bookmarks (specific times in a video, distinct from the auto-generated
-- evenly-spaced scenes shown in the player). Keyed by meta_key like file_meta so bookmarks
-- survive file moves/renames once a content_hash is established.
-- No UNIQUE on (meta_key, sec): "no two bookmarks at the same time" is a policy enforced
-- in addBookmark() with a ±BOOKMARK_NEAR_EPS window, which doesn't map to a column constraint.
CREATE TABLE IF NOT EXISTS lib.scene_bookmarks (
  id INTEGER PRIMARY KEY,
  meta_key TEXT NOT NULL,
  sec REAL NOT NULL CHECK (sec >= 0),
  created_at INTEGER NOT NULL
);
-- (meta_key, sec): the dedupe window above is a range on sec within one file, so
-- both columns are searched, not only meta_key (a file with many bookmarks
-- would otherwise be read through for each one checked).
DROP INDEX IF EXISTS lib.idx_scene_bookmarks_meta;
CREATE INDEX IF NOT EXISTS lib.idx_scene_bookmarks_meta_sec ON scene_bookmarks(meta_key, sec);

-- The meta_keys whose user tags (namespace = '') changed, logged by the
-- triggers below: every workspace keeps its own files_fts.tags_text, and
-- catchUpTagIndex (library.ts) brings it up to date from here, whichever
-- workspace made the change. AUTOINCREMENT so a seq is never handed out again
-- after syncTagIndexes trims old rows.
-- Derived tags are namespaced and never in tags_text (ftsRowSelect, which
-- holds the same namespace = '' rule as the WHEN clauses below), so they are
-- not logged.
CREATE TABLE IF NOT EXISTS lib.tag_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_key TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS lib.trg_meta_tags_ai AFTER INSERT ON meta_tags
WHEN EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND namespace = '')
BEGIN
  INSERT INTO tag_changes (meta_key) VALUES (NEW.meta_key);
END;
-- A row removed by ON DELETE CASCADE fires after its tag is gone, so a tag
-- that no longer exists counts as a user tag here.
CREATE TRIGGER IF NOT EXISTS lib.trg_meta_tags_ad AFTER DELETE ON meta_tags
WHEN NOT EXISTS (SELECT 1 FROM tags WHERE id = OLD.tag_id AND namespace <> '')
BEGIN
  INSERT INTO tag_changes (meta_key) VALUES (OLD.meta_key);
END;
-- Only a change of file or tag: an upsert that rewrites the score of a tag
-- already on the file (addFileTag) changes nothing the index holds.
CREATE TRIGGER IF NOT EXISTS lib.trg_meta_tags_au AFTER UPDATE ON meta_tags
WHEN (OLD.meta_key IS NOT NEW.meta_key OR OLD.tag_id IS NOT NEW.tag_id)
  AND EXISTS (SELECT 1 FROM tags WHERE id IN (OLD.tag_id, NEW.tag_id) AND namespace = '')
BEGIN
  INSERT INTO tag_changes (meta_key) VALUES (OLD.meta_key);
  INSERT INTO tag_changes (meta_key) SELECT NEW.meta_key WHERE NEW.meta_key <> OLD.meta_key;
END;
CREATE TRIGGER IF NOT EXISTS lib.trg_tags_au_name AFTER UPDATE OF name ON tags
WHEN NEW.namespace = ''
BEGIN
  INSERT INTO tag_changes (meta_key) SELECT DISTINCT meta_key FROM meta_tags WHERE tag_id = NEW.id;
END;

-- Workspaces whose own metadata tables have been merged into this database
-- (library.ts). Written in the same transaction as the merge. complete is set
-- once the workspace's own tables are gone too, in a later transaction: a
-- workspace recorded but not complete still has them, and is opened before any
-- write meant for every workspace, which would otherwise miss them and see
-- them merged back later (Workspaces.metadataCores). workspace_id is
-- pathHash of the resolved root, the name of the workspace's data directory —
-- not Workspaces.idFor, which hashes the path as configured and differs from it
-- when the root was added through a symlink.
CREATE TABLE IF NOT EXISTS lib.migrated_workspaces (
  workspace_id TEXT PRIMARY KEY,
  migrated_at INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0
);
`;

/** Open a workspace DB with the shared library attached as `lib`, and apply PRAGMAs.
 *  New tables/columns added after release are reconciled here so existing on-disk
 *  DBs gain them without a separate migration step. Moving a workspace's own
 *  metadata into the library is a separate step (migrateWorkspaceMetadata in
 *  library.ts), since it needs the workspace's id and data directory.
 *
 *  `libraryFile` may be ":memory:" (tests): each connection then gets a private,
 *  empty library. */
export function openDb(file: string, libraryFile: string): DB {
  const db = new Database(file);
  try {
    prepareDb(db, libraryFile);
  } catch (e) {
    // Not left open: the caller retries on the next access, and an open handle
    // keeps Windows from deleting the directory on removal.
    db.close();
    throw e;
  }
  return db;
}

function prepareDb(db: DB, libraryFile: string): void {
  registerFunctions(db);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  // Every workspace connection writes the library, and a checkpoint or another
  // connection's write can hold its lock for a moment: wait instead of failing.
  db.pragma("busy_timeout = 5000");
  attachLibrary(db, libraryFile);
  db.pragma("lib.journal_mode = WAL");
  db.pragma("lib.synchronous = NORMAL");
  db.exec(LIB_DDL);
  backfillLibraryColumns(db);
  db.exec(CORE_DDL);
  // Before backfillColumns: on a DB that pre-dates `btime`, the backfill would add
  // the column and build its two indexes only for the table rebuild here to drop
  // and recreate them (FILES_DDL already carries `btime`; the rebuild's own
  // backfill pass then only adds the indexes). Before migrateFtsToTrigram: that
  // migration reads `files`, so it has to see the final table rather than one
  // about to be rebuilt underneath it.
  migrateFilesTable(db);
  backfillColumns(db);
  migrateFtsToTrigram(db);
}

/** Columns LIB_DDL gained after a library was first created. */
function backfillLibraryColumns(db: DB): void {
  const cols = (
    db.prepare("PRAGMA lib.table_info(migrated_workspaces)").all() as {
      name: string;
    }[]
  ).map((c) => c.name);
  if (!cols.includes("complete")) {
    // Rows from before it are taken as not complete: each workspace is opened
    // once more, finds its own tables gone, and is marked complete.
    db.exec(
      "ALTER TABLE lib.migrated_workspaces ADD COLUMN complete INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function attachLibrary(db: DB, libraryFile: string): void {
  db.prepare("ATTACH DATABASE ? AS lib").run(libraryFile);
}

/**
 * Whether this workspace still holds its own metadata tables, which shadow the
 * library's for every unqualified name on this connection: true until
 * migrateWorkspaceMetadata (library.ts) has merged them, and for good when the
 * backup before that merge cannot be written. An operation meant to reach the
 * library must not rely on unqualified names over such a connection.
 */
export function usesOwnMetadata(db: DB): boolean {
  return hasMainTable(db, "file_meta");
}

/** Whether `main` itself holds `table` (an unqualified name may resolve to `lib`). */
export function hasMainTable(db: DB, table: string): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table) !== undefined
  );
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
  // A workspace's own file_meta exists only until its metadata is merged into
  // the library (whose LIB_DDL already has these columns and the index). Until
  // then it is what this connection reads, so it still needs them.
  if (usesOwnMetadata(db)) {
    if (!hasColumn(db, "file_meta", "thumb_offset_sec")) {
      db.exec("ALTER TABLE main.file_meta ADD COLUMN thumb_offset_sec REAL");
    }
    if (!hasColumn(db, "file_meta", "resume_position")) {
      db.exec("ALTER TABLE main.file_meta ADD COLUMN resume_position REAL");
    }
    // Drives the "In progress" filter (see appendSearchConditions).
    db.exec(
      "CREATE INDEX IF NOT EXISTS main.idx_file_meta_resume ON file_meta(meta_key) WHERE resume_position IS NOT NULL",
    );
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
  // Drives sort=addedAt (the timeline's "added" axis) in its default DESC
  // direction; created_at is never NULL, so no NULLs-last term.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_files_alive_added ON files(created_at DESC, id) WHERE deleted_at IS NULL",
  );
}

/** Versionless idempotent migration: rebuild `files` once when its stored DDL is
 *  older than FILES_DDL in either of two ways SQLite cannot ALTER:
 *  - DBs created before audio support carry a `CHECK (kind IN ('video','image'))`,
 *    which rejects every audio INSERT.
 *  - DBs created before metadata moved out of the workspace derive the no-hash
 *    meta_key from `root_id || ':' || rel_path`, which is unique only within one
 *    database. Metadata stored under those keys is moved to the new ones
 *    (rewritePathMetaKeys) in the same transaction.
 *
 *  Detected from the stored DDL rather than a version number (Principle III), so it is
 *  safe to run from any prior state and safe to re-run. Unlike files_fts this table is
 *  NOT derived data — the copy must be lossless:
 *  - `files.id` is carried across explicitly: files_fts is a standalone FTS5 table
 *    (not content=files) whose rowid is set to files.id by syncFts, and searches
 *    join the two on it — renumbering would silently break every search result.
 *  - The column list is read from the live table so a DB that pre-dates `btime`
 *    (added by backfillColumns, which runs after this) copies only the columns it
 *    actually has; the rebuilt table gets `btime` from FILES_DDL, NULL throughout.
 *  - `meta_key` is a VIRTUAL generated column and must be excluded from the INSERT;
 *    it re-derives itself from content_hash / abs_path.
 *  - DROP TABLE takes the indexes with it, so CORE_DDL and backfillColumns are re-run
 *    afterwards to restore them.
 *  User-curated metadata is keyed by meta_key in separate tables; only the rows
 *  under an old-style no-hash key are rewritten. */
function migrateFilesTable(db: DB): void {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files'",
    )
    .get() as { sql: string } | undefined;
  if (!row) return;
  const hasAudio = row.sql.includes("'audio'");
  const hasCurrentMetaKey = row.sql.includes(META_KEY_EXPR);
  if (hasAudio && hasCurrentMetaKey) return;
  // The key rewrite knows one older expression only, so it is gated on that
  // expression being present rather than on the current one being absent.
  const hasRootScopedKey = row.sql.includes(
    "'p:' || root_id || ':' || rel_path",
  );
  // Real (non-generated) columns of the existing table. PRAGMA table_info omits
  // VIRTUAL generated columns, which is exactly the meta_key exclusion we need.
  const cols = (
    db.prepare("PRAGMA table_info(files)").all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((n) => n !== "meta_key");
  const colList = cols.map((c) => `"${c}"`).join(", ");
  db.transaction(() => {
    // Read the old keys off the table before it is replaced.
    if (hasRootScopedKey) rewritePathMetaKeys(db);
    db.exec("ALTER TABLE files RENAME TO files_old");
    // Recreate `files` (and only it) from FILES_DDL; CORE_DDL below restores
    // the indexes that RENAME carried over to files_old.
    db.exec(FILES_DDL);
    db.exec(`INSERT INTO files (${colList}) SELECT ${colList} FROM files_old`);
    db.exec("DROP TABLE files_old");
  })();
  // Indexes on the old table were dropped with it; CORE_DDL and backfillColumns are
  // both idempotent and recreate every index (including the btime ones).
  db.exec(CORE_DDL);
  backfillColumns(db);
  // The copy plus the index rebuilds write roughly 1.5x the database size into
  // the WAL, and nothing shrinks a WAL file on its own — without this it would
  // sit next to the database at that high-water mark for good.
  // `main.`: unqualified, it would checkpoint the attached library too and wait
  // out any reader of it.
  db.pragma("main.wal_checkpoint(TRUNCATE)");
}

/** The tables that hold user-curated metadata under a meta_key. migrateMetaKey
 *  (queries/meta.ts) lists the same tables; keep the two in step. */
export const META_KEYED_TABLES = [
  "file_meta",
  "meta_tags",
  "play_history",
  "scene_bookmarks",
] as const;

/**
 * Move metadata stored under an old-style no-hash key (`p:<root_id>:<rel_path>`)
 * to the absolute-path key the rebuilt `files` table derives for the same file.
 * A row that would clash with one already under the new key is dropped: both
 * describe this workspace's own copies, before any merge into the library.
 * Keys that no file row maps to are left as they are. Reads the files table as it is before the rebuild; the caller
 * supplies the transaction.
 *
 * Names are qualified with `main.` and missing tables skipped because these
 * tables are to move to a database shared by every workspace: what is rewritten
 * here is always this workspace's own copy, when it still has one.
 */
function rewritePathMetaKeys(db: DB): void {
  db.exec(`
    DROP TABLE IF EXISTS temp.path_key_map;
    CREATE TEMP TABLE path_key_map (old_key TEXT PRIMARY KEY, new_key TEXT NOT NULL);
    INSERT OR IGNORE INTO temp.path_key_map (old_key, new_key)
      SELECT 'p:' || root_id || ':' || rel_path, 'p:' || abs_path
      FROM main.files WHERE content_hash IS NULL;
  `);
  for (const table of META_KEYED_TABLES) {
    if (!hasMainTable(db, table)) continue;
    db.exec(`
      UPDATE OR IGNORE main.${table}
        SET meta_key = (SELECT new_key FROM temp.path_key_map WHERE old_key = meta_key)
        WHERE meta_key IN (SELECT old_key FROM temp.path_key_map);
      DELETE FROM main.${table}
        WHERE meta_key IN (SELECT old_key FROM temp.path_key_map);
    `);
  }
  db.exec("DROP TABLE temp.path_key_map");
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
     ${ftsRowSelect("files f INDEXED BY idx_files_meta_key")}
       AND f.meta_key IN (SELECT value FROM json_each(?))`,
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
 * lock or mutate schema. Throws if either file does not exist. The schema of
 * both databases (openDb) and the merge of the workspace's own metadata into the
 * library (migrateWorkspaceMetadata) are assumed to have already run in the main
 * process before any read-only handle is opened. A handle opened earlier still
 * reads correctly afterwards: the merge drops the workspace's own tables, and
 * SQLite re-resolves the unqualified names to `lib` on the next statement.
 */
export function openDbReadonly(file: string, libraryFile: string): DB {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  registerFunctions(db);
  // Opened read-only along with the connection it is attached to.
  attachLibrary(db, libraryFile);
  // Connection-local (never written to the file): even in WAL mode a reader
  // can hit SQLITE_BUSY around writer checkpoints; retry briefly instead of
  // surfacing an exception to the renderer.
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * The shared library on its own, read-only: what the app reads before any
 * workspace is open (which workspaces it has a record of, whether it is
 * sound). Throws when it cannot be opened.
 */
export function openLibraryReadonlyOrThrow(libraryFile: string): DB {
  const db = new Database(libraryFile, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

/** The shared library on its own, writable: for repairing a copy before it
 *  is put back (libraryBackup.ts). Throws when it cannot be opened. */
export function openLibraryForRepair(libraryFile: string): DB {
  const db = new Database(libraryFile, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

/** openLibraryReadonlyOrThrow, or null when the file does not exist yet or
 *  cannot be opened. */
export function openLibraryReadonly(libraryFile: string): DB | null {
  try {
    return openLibraryReadonlyOrThrow(libraryFile);
  } catch {
    return null;
  }
}

/**
 * Whether the workspace database at `dbFile` still holds its own metadata
 * tables, read without attaching or preparing anything. Null when it cannot
 * be opened: nobody can tell.
 */
export function fileUsesOwnMetadata(dbFile: string): boolean | null {
  let db: DB | undefined;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    return usesOwnMetadata(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** The `code` an error from SQLite or the file system carries, if any. */
export function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
