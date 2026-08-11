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
- `tags` — the tag master, unique on `(namespace, name)`. An empty namespace
  means the tag is the user's own; a non-empty one means it is owned by a
  pipeline (see [Derived tags](#derived-tags)).
- `file_meta` — durable user metadata (see below).
- `meta_tags` — tag associations.
- `play_history` — playback history.
- `scene_bookmarks` — user-created scene positions.
- `settings` — a key/value store, currently holding the derived-tag ruleset
  version (see [Derived tags](#derived-tags)).
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

Indexes go in `CORE_DDL` too — `openDb()` re-executes it on every open, so
`CREATE INDEX IF NOT EXISTS` reaches existing databases without any entry in
`backfillColumns()`.

The `auto_meta_ruleset_version` row in `settings` is **not** an exception to this
rule. It versions _derived data_, not schema: it gates nothing about DDL, and a
database whose marker is missing or stale simply has its derived tags rebuilt on
the next scan.

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

- `meta_tags` — tag associations (`source`, optional `score`). `source` is
  `manual` for hand-applied tags and `auto-meta` for the metadata classifier.
- `scene_bookmarks` — user-created scene positions in a video (`sec >= 0`),
  distinct from the auto-generated evenly-spaced scenes the player shows.
- `play_history` — playback records (`played_at`, `position`, `via` =
  `browser` | `external`).

## Full-text search

`files_fts(rel_path, tags_text)` is an FTS5 virtual table whose `rowid` matches
`files.id`. It is kept in sync by `syncFts()` in `electron/core/tags.ts`; call it
after any tag change so the searchable `tags_text` stays current. For a batch of
files — a tag rename, a merge, the derived-tag backfill — use
`resyncFtsForKeys()` in `db.ts` instead, which re-indexes a whole set of
`meta_key`s in one pair of statements.

`tags_text` holds the **user's own** tag names, joined by spaces and
deduplicated across sources. Three places produce it — `syncFts()`,
`resyncFtsForKeys()` and the trigram rebuild — and they must never drift, so the
projection lives in a single `FTS_ROW_SELECT` constant in `db.ts`.

Generated tags are deliberately **not** indexed. The tokenizer is trigram, so
indexing `dur:long` would make a plain search for "long" return every long
video — and likewise for "short", "square", "h264".

Exact tag conditions instead live in the search box as **directives**, which
`buildSearchTerms()` in `queries/files.ts` pulls out before the FTS split and
resolves against the `tags` table:

- `tag:beach` — a user's own tag. Clicking a tag writes this into the box, so the
  condition is visible and editable without the exact match degrading into a
  substring search that also hits file names.
- `meta:4k`, `meta:long` — a generated tag; the only free-text route to them.
  The bare value is enough because the categories share no values (declared in
  `AUTO_META_VALUES` and pinned by a ruleset test); the qualified `meta:res:4k`
  is still accepted.

Values containing spaces are quoted (`tag:"beach house"`); `splitSearchTokens()`
and `joinSearchTokens()` in `shared/tags.ts` round-trip them. A space after the
colon is folded away (`tag: beach` = `tag:beach`) inside the tokenizer, so the
chip the box draws and the SQL the query produces can never disagree about it.
Both `tag` and
`meta` are reserved manual-tag prefixes, so neither directive can be shadowed by
a tag the user creates. The structured `SearchQuery.tags[]` field still works and
is what saved searches and Discover URLs carry.

The box itself (`SearchTokenInput`) renders a directive as a **chip** rather than
as raw text, so it is added and removed as one unit: a directive only means
anything whole, and backspacing through the middle of one silently turns an exact
tag match into a substring search. A token becomes a chip once the user closes it
with a space or Enter — never mid-word — and `hasOpenQuote()` keeps a space typed
inside an unclosed `tag:"…` phrase from counting as that boundary. Free text stays
ordinary editable text, so the box remains one plain string end to end.

Focus never leaves the input — the chips are a rendering of the query string, not
widgets of their own. Once the caret runs out of text to its left, Left and
Backspace start walking back over the chips instead, highlighting one at a time;
Left/Right move the highlight, Backspace/Delete removes the highlighted chip, and
Escape, Right past the last chip, or simply typing returns to the text. Backspace
highlights before it deletes because a chip goes with no undo.

While a directive is being typed the box completes it from the tag catalog:
`tag:` offers the user's own tags, `meta:` the generated ones. The match is a
case-insensitive substring — a tag is as often remembered by a word in the middle
of it — ranked prefix-first then by file count, and capped at
`MAX_TAG_SUGGESTIONS`. The candidates come from the `tags_list_all` catalog the
tag management screen already caches, filtered in the renderer: one query instead
of one per keystroke, and correct in the `All` view and in collections, where a
workspace-scoped `tags_list` cannot resolve a database at all.

## Derived tags

Tags whose `source` is not `manual` are owned by a pipeline and are read-only to
the user: rename, merge and delete reject them, and the tag management screen
offers no affordance for them. Today the only such source is `auto-meta`, which
`electron/core/autoMetaTags.ts` derives during the scan from the ffprobe columns
already stored on `files`:

| Namespace | Applies to    | Values                                               |
| --------- | ------------- | ---------------------------------------------------- |
| `res`     | video + image | `4k` / `1080p` / `720p` / `sd`, from the longer edge |
| `dur`     | video         | `short` (<1 min) / `medium` / `long` (>30 min)       |
| `codec`   | video         | normalized `codec_name` (`h264`, `hevc`, `av1`, …)   |
| `orient`  | video + image | `vertical` / `horizontal` / `square`                 |

Application is a diff against the current `(meta_key, source)` rows, so
re-scanning an unchanged library writes nothing. Files that the scan classifies
as `unchanged` or `moved` never enter the thumbnail pool, so an existing library
is filled in by a separate chunked pass in `runScan()` (progress phase `tags`),
gated on a ruleset version recorded in the `settings` table under
`auto_meta_ruleset_version`. Bumping `AUTO_META_RULESET_VERSION` re-derives every
file on the next scan.

The set of namespaces is **not closed**. No code that decides tag _identity_ may
enumerate it: search tokens resolve against the `tags` table itself, and the tag
screen sorts unknown namespaces after the known ones rather than dropping them.

## Query layer

`electron/core/queries.ts` is a barrel that re-exports the implementations split
across `electron/core/queries/`:

- `files.ts` — `searchFiles`, `randomFiles`, `fileDetail`, and the favorite
  filter.
- `meta.ts` — metadata reads and writes.
- `bookmarks.ts` — scene bookmark operations.
- `thumbs.ts` — thumbnail-related queries.
- `scanRoots.ts` — scan-root bookkeeping.
