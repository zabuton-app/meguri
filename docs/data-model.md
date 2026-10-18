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
- `files` — the file index: `rel_path`, `abs_path`, `kind` (`video` | `image` |
  `audio`), size/mtime/inode, `content_hash`, media metadata (`width`, `height`,
  `duration`, `codec`, `fps`, `captured_at`), `thumb_path` / `thumb_status`, and
  `deleted_at` / `excluded_at` markers. For audio, `width` / `height` / `fps`
  stay NULL even when the file embeds cover art — the artwork's dimensions
  describe the jacket, not the track. Images keep `fps` NULL too, except
  animated ones (a GIF with more than one frame, or an APNG): ffprobe reports a
  default 25/1 for a still, which is not a property of the file. A tiled
  HEIF/AVIF (as phone cameras write) keeps `width` / `height` NULL: depending
  on the version, ffprobe reports one tile's size, 0x0, or no stream at all,
  never the full image. Its stored `meta` keeps only the first tile's stream.
- `tags` — the tag master, unique on `(namespace, name)`. An empty namespace
  means the tag is the user's own; a non-empty one means it is owned by a
  pipeline (see [Derived tags](#derived-tags)). The constraint tells
  spellings apart, but the code does not: two names are one tag when their
  `tagIdentityKey()` (`shared/tags.ts`) is the same — case aside, over all of
  Unicode, so `Trip` and `trip` are one tag and so are `Été` and `été`.
  Spacing, composition and invisible characters aside too (`tidyTagName()`):
  auto tagging stores names composed (NFC), with each run of whitespace as one
  space and control and format characters dropped, while a name typed by hand
  is kept as typed, so `New  Name` and `New Name` are one tag. Adding a
  tag by hand, the bulk editor, rename, auto tagging, the detail view's name
  parts and the `tag:` search all compare by it; SQL reaches it as the
  `tag_key()` function each connection registers, since SQLite's own `lower()`
  and `NOCASE` stop at ASCII. A name another spelling already has lands on
  that tag in its existing spelling. A library from before this rule may hold
  two such rows; they stay, a name that means both resolves to the one spelled
  exactly so, else the older (`findManualTag()`), and renaming one to the
  other merges them. The `All` view's catalog lists spellings apart.
- `file_meta` — durable user metadata (see below).
- `meta_tags` — tag associations.
- `play_history` — playback history.
- `scene_bookmarks` — user-created scene positions.
- `settings` — a key/value store, holding the derived-tag ruleset version (see
  [Derived tags](#derived-tags)) and the files auto-tagging still owes (see
  [Auto tagging](#auto-tagging)).
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

Free-text tokens are ANDed. A token may carry alternatives separated by `|`
(`yoga|ヨガ`), any of which satisfies it; `\|` is a literal `|`, for the file
names that contain one. `searchTokenTerms()` in `shared/tags.ts` is the one
place that reads this syntax. In the query, the alternatives long enough for
the trigram index become one `MATCH` with `OR`, the short ones the same `LIKE`
fallback short tokens use, and the two halves are ORed — a long alternative is
never sent to `LIKE` because a short one sits beside it, since `LIKE` is slower
and folds case for ASCII only.

The auto-tagging screen uses this to search the library for a dictionary
entry's terms (`searchLibrary()` in `src/lib/ui-events.ts`, which
replaces the text query rather than adding to it) — by the search box's rules,
a substring of the path or of the tags, not by the entry's own word matching.

Generated tags are deliberately **not** indexed. The tokenizer is trigram, so
indexing `dur:long` would make a plain search for "long" return every long
video — and likewise for "short", "square", "h264".

Exact tag conditions instead live in the search box as the **`tag:` directive**,
which `buildSearchTerms()` in `queries/files.ts` pulls out before the FTS split
and resolves against the `tags` table:

- `tag:beach` — a user's own tag. Clicking a tag writes this into the box, so the
  condition is visible and editable without the exact match degrading into a
  substring search that also hits file names.
- `tag:4k`, `tag:long` — a generated tag; this is the only free-text route to
  them. The bare value is enough because the categories share no values (declared
  in `AUTO_META_VALUES` and pinned by a ruleset test); the qualified `tag:res:4k`
  is accepted too.

**One prefix, both kinds.** A bare value that names a manual tag _and_ a
generated one resolves to both, which is the reading a person means by `tag:4k`;
the qualified form narrows it back down. A second prefix for generated tags was
tried and removed: nobody thinks of "my tags" and "the scanner's tags" as
separate things to search, and it only bought two vocabularies to keep straight.

Values containing spaces are quoted (`tag:"beach house"`); `splitSearchTokens()`
and `joinSearchTokens()` in `shared/tags.ts` round-trip them. A space after the
colon is folded away (`tag: beach` = `tag:beach`) inside the tokenizer, so the
chip the box draws and the SQL the query produces can never disagree about it.
`tag` is a reserved manual-tag prefix, so the directive cannot be shadowed by a
tag the user creates. The structured `SearchQuery.tags[]` field still works and
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
highlights before it deletes because a chip goes with no undo. Clicking a chip
highlights it too, and so does clicking a tag that is _already_ a condition:
`onTagClick` in Home compares the result of `addSearchTokens()` by reference and,
when nothing changed, sends `highlightSearchToken()` over the event bus rather
than leaving what looks like a dead click.

While a directive is being typed the box completes it from the tag catalog — the
user's own tags and the generated ones in one list, since one directive matches
both. The match is a case-insensitive substring — a tag is as often remembered by
a word in the middle of it — ranked prefix-first then by file count, and capped
at `MAX_TAG_SUGGESTIONS`. Tab or Enter accepts the highlighted candidate and
chips it; Tab preventDefaults so the caret stays put for the next condition,
while Shift+Tab still leaves the field. The candidates come from the
`tags_list_all` catalog the tag management screen already caches, filtered in the
renderer: one query instead of one per keystroke, and correct in the `All` view
and in collections, where a workspace-scoped `tags_list` cannot resolve a
database at all.

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

## Auto tagging

Rules and a keyword dictionary propose tags from a file's **name**, and folder
rules from where the file is. The engine
is `shared/autoTag.ts`, shared by both processes so the auto-tagging screen
previews with the code a scan runs:

- A **rule** is a regular expression run globally over the name without its
  extension. Each match names a tag through a template (`$1`), optionally split
  on `, 、 / ／ ・`, case-folded, and dropped when it is in the rule's exclude
  list. The built-in rules cover a leading code prefix and bracketed text;
  they ship switched off, and the screen can reset them to that state.
- A **folder rule** goes by where a file is rather than by its name: every
  file under a folder of one workspace — subfolders included — gets the rule's
  tags. The folder is kept as the workspace id plus the path inside it, in the
  normalized form of `shared/folderPath.ts` (`""` is the whole workspace).
  Comparing paths cannot hang, so a scan adds these in the main process to
  what the worker returned for the names. `withFolderTags()` is the one place
  the two are put together; the screen's Folders tab lists the files under a
  rule by the same comparison.
- A **keyword** is some terms to find and the tags to add: finding any of the
  terms in the name (again without its extension) proposes every one of the
  tags; in `word` mode an ASCII term must stand between non-alphanumerics. An
  entry written before it had tags of its own (one `tag` plus `aliases`) is
  read as those terms, adding that tag.

Unlike [derived tags](#derived-tags), what the engine proposes is attached as
the user's **own** tags: no namespace, `source = 'manual'`, indexed in FTS,
removable per file. A name that differs from an existing tag only by case
reuses that tag, by the same rule as every other path (see `tags` under
[Schema](#schema)).
Attaching only ever adds — changing a rule does not take back what it already
tagged — and `attachAutoTags()` reports exactly the pairs it added, which is
what rolls back an apply that failed partway (kept in memory in the main
process, not persisted). The screen keeps no record of what it applied: taking
a tag off again goes by what the files carry, through `auto_tag_edit`. Renaming
a tag of a keyword or folder rule on the screen offers to move the files the
condition reaches from the old tag to the new one, by the same reading.

The tag screen's rename, merge and delete reach the conditions too, so the
next scan does not put the old name back. The conditions are the app's, not a
workspace's: when a keyword entry or folder rule names one of the tags, the
operation runs in every workspace, whichever one is in view, and those
conditions are rewritten with it (`retagConditions()` in
`shared/autoTagConditions.ts`). A delete drops the tag from them; one left with
no tags stays. The operation's tags resolve by `tagIdentityKey()` in each
database, as the conditions are matched. The conditions are written after the
databases, so a refused operation changes neither, and one that fails partway
is finished by doing it again. Regex rules name their tags through a template
and are left alone.

The screen sends ids it loaded earlier, and a rebuild hands ids to other files
while a move gives a file another name. So `auto_tag_apply` and `auto_tag_edit`
take, with each id, the place the screen read it at, and write only to the
files still there (`keepStillAt`, the same check a scan's pass makes before
its writes); the rest come back as `moved`, and the screen reads the files
again. Each call is split to fit the file count, the (file, tag) pairs and the
places' total length (`MAX_AUTO_TAG_PLACE_CHARS`).

The configuration (`rules`, `keywords`, `folders`, `applyOnScan`, dismissed
suggestions and excluded terms) is app-wide, in `config.json` under `autoTag`.
With `applyOnScan` on, `runScan()` runs the engine over the files the scan
inserted, updated or moved, ahead of the FTS sync and the thumbnail pool. The
ids still owed are kept in `settings` under `auto_tag_pending` until the pass
completes, because a scan aborted in between reports those files as unchanged
the next time round.

In the main process the part of the engine that reads names is evaluated in a
worker thread (`electron/autoTagWorker.ts`, driven by `AutoTagWorkerClient`): a
rule is an arbitrary regular expression, and one that backtracks without end
cannot be interrupted on the thread running it. The engine crosses to the
worker once, under a version, and each chunk then carries only the names and
the version it is for. The worker holds the last few engines sent
(`AUTO_TAG_ENGINES_HELD`), so passes running side by side do not resend theirs
at every chunk; the client counts them the same way and sends an engine ahead
of a chunk the worker would not hold it for, a new worker's first included.
The worker runs a chunk's rules
one at a time (`deriveChunk`) and names each as it starts, then the keywords
(which are blamed on no rule); the client watches
the worker rather than each request, so time spent queued behind another pass
does not count. A worker silent for the whole budget is stuck in the rule it
last named: that rule is left out from then on (known by what it does, so an
edit gives it another chance), the worker is terminated, and everything waiting
is sent again to a new one. A rule that hangs therefore costs its own tags and
nothing else. A worker that cannot run fails closed — nothing is evaluated on
the main thread in its place; the scan logs it and carries on with the folder
rules' tags only, and the files stay owed for what their names give.

`shared/autoTagAnalysis.ts` builds the screen's views on top of the engine —
suggestions (frequent words of the names that no rule or keyword produces
yet) and a file name cut into taggable parts for the detail view. Those
run in the renderer over the names loaded by `auto_tag_files` (capped at
`MAX_AUTO_TAG_FILES`); every write goes through `auto_tag_apply` or
`auto_tag_edit`, which only say which files get which tags.

A user's regular expression never runs on the renderer's own thread: one that
backtracks without end would hang the screen. The screen runs the rules in a
worker (`src/routes/AutoTag/rules.worker.ts`), rule by rule over the names,
each chunk of names under the same deadline a scan's worker has. A rule that
misses it is given up on — the worker is ended and a new one carries on with
the rules after it — and shown as too slow, left out of the preview and the
suggestions until its pattern is changed. What a rule finds comes back in a
size that does not grow with how much it matches: a count, the positions it
matches, the matches for the rows the editor draws, and the words a
suggestion has to know about. Where no worker can start the rules are not
run at all. The keywords, escaped literals, are run in place.

"Apply to existing files" writes chunk by chunk; when a later chunk fails, the
ones before it stay, and the caches and the screen are read again so that they
show it.

`config.ignored` holds suggestions dismissed on the suggestions tab. Common
words (`STOP_WORDS` in `shared/autoTagAnalysis.ts`) are never suggested.
Neither changes what the rules or the dictionary themselves produce. An
`excludedTerms` list an earlier version stored is no longer read.

## Query layer

`electron/core/queries.ts` is a barrel that re-exports the implementations split
across `electron/core/queries/`:

- `files.ts` — `searchFiles`, `randomFiles`, `fileDetail`, and the favorite
  filter.
- `meta.ts` — metadata reads and writes.
- `bookmarks.ts` — scene bookmark operations.
- `thumbs.ts` — thumbnail-related queries.
- `scanRoots.ts` — scan-root bookkeeping.
