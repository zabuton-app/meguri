# Data Model

Each workspace has its own SQLite database. This document covers the storage
layout, the schema, the versionless migration scheme, the `meta_key` design that
keeps user-edited metadata durable, full-text search, and the query layer.

## Storage layout

A workspace's generated files live under Electron's `userData`, in a directory
named after the workspace's path hash:

```text
<userData>/roots/<hash>/
├─ db.sqlite   # this workspace's database (WAL mode)
└─ thumbs/     # generated thumbnails (WebP)
```

`electron/core/paths.ts` resolves these paths. The top-level
[README](../README.md#where-data-is-stored) is the canonical description of the
full storage tree, including `config.json`.

## Schema

All DDL lives in `electron/core/db.ts` (`CORE_DDL`). The database opens in WAL
mode with `synchronous = NORMAL` and `foreign_keys = ON`.

The main tables:

- `scan_roots` — the registered root for this database.
- `files` — the file index: `rel_path`, `abs_path`, `kind` (`video` | `image`),
  size/mtime/inode, `content_hash`, media metadata (`width`, `height`,
  `duration`, `codec`, `fps`, `captured_at`), `thumb_path` / `thumb_status`, and
  `deleted_at` / `excluded_at` markers.
- `tags` — the tag master, unique on `(namespace, name)`.
- `file_meta` — durable user metadata (see below).
- `meta_tags` — tag associations.
- `play_history` — playback history.
- `scene_bookmarks` — user-created scene positions.
- `settings` — a key/value store.
- `files_fts` — the FTS5 virtual table (see below).

## Versionless migrations

Migrations deliberately use **no version number**. There is no `SCHEMA_VERSION`
and no `user_version`. Existing on-disk databases are reconciled by two
idempotent mechanisms in `db.ts`:

- `CREATE TABLE IF NOT EXISTS` in `CORE_DDL` for whole tables.
- `backfillColumns()`, which uses `hasColumn()` to add columns one at a time with
  `ALTER TABLE ... ADD COLUMN`, each step safe to run repeatedly.

This avoids a past failure mode where bumping `user_version` first left columns
missing on databases that never received the corresponding `ALTER`. To evolve the
schema: add the DDL (so fresh databases get it) and, for a new column on an
existing table, add the matching idempotent `ALTER` to `backfillColumns()`.

## Metadata and `meta_key`

User-edited metadata is split into `file_meta`, whose primary key is **not**
`files.id` but `meta_key`:

```text
meta_key = COALESCE(content_hash, 'p:<root_id>:<rel_path>')
```

`files.meta_key` is a `VIRTUAL` generated column computing the same expression.
It prefers `content_hash` and falls back to a root-scoped `rel_path` when no
hash is available. Because metadata is keyed this way, it **survives file moves,
renames, and rebuilds of the `files` / `files_fts` tables** — anything that
would change or regenerate `files.id`.

`file_meta` holds `favorite`, `rating` (0–5), `last_accessed_at`, and
`thumb_offset_sec` (the user-chosen thumbnail frame offset, `NULL` meaning the
auto-extracted representative frame).

## Derived tables

These tables are keyed by `meta_key` for the same durability reason:

- `meta_tags` — tag associations (`source`, optional `score`).
- `scene_bookmarks` — user-created scene positions in a video (`sec >= 0`),
  distinct from the auto-generated evenly-spaced scenes the player shows.
- `play_history` — playback records (`played_at`, `position`, `via` =
  `browser` | `external`).

## Full-text search

`files_fts(rel_path, tags_text)` is an FTS5 virtual table whose `rowid` matches
`files.id`. It is kept in sync by `syncFts()` in `electron/core/tags.ts`; call it
after any tag change so the searchable `tags_text` stays current.

## Query layer

`electron/core/queries.ts` is a barrel that re-exports the implementations split
across `electron/core/queries/`:

- `files.ts` — `searchFiles`, `randomFiles`, `fileDetail`, and the favorite
  filter.
- `meta.ts` — metadata reads and writes.
- `bookmarks.ts` — scene bookmark operations.
- `thumbs.ts` — thumbnail-related queries.
- `scanRoots.ts` — scan-root bookkeeping.
