# Architecture

Meguri is an Electron app with a Node main process and a React renderer. This
document describes the boundary between them, the typed IPC that crosses it, the
tray-resident lifecycle, and the workspace and collection models layered on top.

See the [README architecture sketch](../README.md#architecture) for the
top-level directory map.

## Process model

The main process (Node, `electron/`) owns the database, scanning, media
indexing, and playback support. The renderer (React, `src/`) holds no native
dependencies and reaches the main process **only** through `preload`
(`window.api`). Videos, images, and thumbnails are served from a local HTTP
server that lives inside the main process (see [Media Pipeline](media-pipeline.md)).

This separation is strict: the renderer never touches the filesystem, the
database, or ffmpeg directly. Everything goes over IPC or the media server.

## IPC type system

The schemas in `shared/ipc/` are the single source of truth for IPC, imported by
both processes so there is nothing to hand-sync.

### Schema and channels

- `shared/ipc/schema.ts` defines the DTO schemas as Zod values. `FileRow`,
  `FileDetail`, `SearchQuery`, and friends each have a `*Schema` Zod value plus
  a same-named `type` inferred from it.
- `shared/ipc/channels.ts` declares the per-channel contract:
  - `ChannelInputs` — a Zod schema per channel, validated at runtime by the main
    process.
  - `ChannelOutputs` — a TypeScript interface giving each channel's return type.
    Outputs are plain types, not Zod schemas, because the renderer trusts data
    coming from main and needs no runtime check.

There are roughly three dozen invoke channels, covering app status, workspace and
collection management, scanning, file search and mutation, tags, scene
bookmarks, thumbnail offsets, and shell operations (open externally, open
folder, copy path, open URL, toggle DevTools).

`electron/core/types.ts` and `src/ipc/types.ts` are thin re-export shims over the
shared schemas, kept for import-path compatibility; they hold no definitions of
their own.

### Validation

`electron/core/ipcHandler.ts` exposes a `handle(channel, fn)` helper. It looks up
`ChannelInputs[channel]`, runs `safeParse()` on the incoming payload, and only
then calls `fn` with the parsed data. Malformed payloads are rejected here, which
makes this a real defense layer even though calls already pass through the
preload whitelist.

### Events

Main-to-renderer messages are sent with `webContents.send(channel, payload)`.
The event channels are listed in `EVENT_CHANNELS` in `shared/ipc/channelNames.ts`
(re-exported from `shared/ipc/channels.ts`):

- `scan:progress` — scan progress updates.
- `thumb:done` — a thumbnail finished generating.
- `scan:done` — a scan job completed (with stats, or an abort/error flag).
- `workspace:changed` — the active workspace changed.

### Adding a new IPC channel

1. If the DTO is new, add its Zod schema to `shared/ipc/schema.ts`.
2. Add the channel name to `INVOKE_CHANNELS` (or `EVENT_CHANNELS` for events) in
   `shared/ipc/channelNames.ts`.
3. Add `ChannelInputs.<channel>` and `ChannelOutputs[<channel>]` to
   `shared/ipc/channels.ts`. A compile-time check ensures these match
   `INVOKE_CHANNELS`.
4. Add `handle("<channel>", (input) => ...)` inside the relevant
   `register*Handlers()` under `electron/ipc/`. Handlers are grouped by domain,
   one module each (`status.ts`, `workspaces.ts`, `scan.ts`, `files.ts`,
   `tags.ts`, `autoTag.ts`, `bookmarks.ts`, `thumbs.ts`, `shell.ts`,
   `logo.ts`, `updates.ts`); `electron/ipc/index.ts` wires them up in `registerIpc()`.
   Each group receives an `IpcContext` (`electron/ipc/context.ts`) with what it
   needs from the main process — the `Workspaces`, the query worker client,
   `emit()`, the `ScanManager`, and live getters for the window and media
   server.
   Shared helpers (`coreById`, `queryTargets`, `scopedCores`,
   `ensureFileInsideRoot`) are in `electron/ipc/helpers.ts`; a handler that
   hands a file path to the OS must resolve it through `ensureFileInsideRoot`
   so the path is checked against the workspace root. The output type is
   checked against the channel definition automatically.
5. Add `api.<method>` to `src/ipc/client.ts`. Its input and output types are
   inferred from the channel name.

The preload whitelist is built from `shared/ipc/channelNames.ts` at bundle time,
so it stays in sync without a separate manual list.

A channel whose input the renderer must not be able to forge goes in
`PRELOAD_INVOKE_CHANNELS` instead. Those channels are validated and handled like
any other, but they are left off the whitelist: only a dedicated preload function
calls them. `workspace_add_path` is the one such channel. A folder dropped from
the OS reaches the renderer as a `File`; `window.api.addDroppedWorkspace(file)`
resolves its path in the preload with `webUtils.getPathForFile()` and sends it to
main. The renderer never sees the path. Main still re-checks that it is an
existing directory (`droppedDirectory()` in `electron/core/paths.ts`) before
registering it.

## Tray-resident lifecycle

The app lives in the system tray and **does not quit when its window is closed**.
This is an invariant in `electron/main.ts`; preserve it when changing window or
lifecycle behavior:

- The window's `close` event calls `preventDefault()` and hides the window to the
  tray unless the app is quitting (`isQuitting()`, derived from `quitPhase`).
- `window-all-closed` does **not** call `app.quit()` (unless tray support is
  disabled, e.g. in Docker — then closing the last window quits).
- The app quits via the tray "Quit" menu item, macOS Cmd+Q, or the last window
  closing when tray support is disabled; all go through `app.quit()` and
  therefore `before-quit`, which advances `quitPhase`.
- `before-quit` is a two-pass gate (Linux / Windows): the first pass calls
  `preventDefault()`, runs the async `shutdown()` (hide the window, stop the
  local servers, abort scans, dispose the query worker), then closes every
  workspace DB handle and re-enters `app.quit()`; the second pass lets the quit
  proceed. Repeated quit requests during the wait are absorbed, and the wait is
  bounded so a stuck teardown cannot keep the app alive. Once quitting, no scan
  starts and no workspace DB is reopened.
- On macOS `before-quit` tears down synchronously instead (`teardownSync()`):
  cancelling the quit there would also cancel an OS log-out. The same
  synchronous path handles `powerMonitor` "shutdown" (macOS / Linux) and the
  window's `session-end` (Windows shutdown / log-off, which never reaches
  `before-quit`).
- If the renderer process crashes, the main window is reloaded with a growing
  delay, bounded per minute; past that (or on a launch / integrity failure) the
  user is asked to reload or quit instead of being left with a blank window.
- A single-instance lock prevents a second copy from launching.
- The tray and window icons are base64-embedded images
  (`electron/core/logoAssets.ts`), to avoid bundle path-resolution issues.
  Three logo variants exist (`dark` = vermilion kanji, `light` = inverted,
  `enso` = pictorial brush circle with a media card, raster-sourced — no SVG
  master); the choice is persisted as `logo` in
  main's `config.json` and switched from Settings via the `logo_get` /
  `logo_set` IPC channels. The renderer mirrors the same choice through
  `useLogo()` (react-query cache), which drives the Settings picker and the
  in-app logo in the workspace rail.

## Workspace model

Each scan root is an independent workspace with its own database and thumbnails.
The root path is hashed (SHA1, first 16 hex characters) into a stable ID via
`Workspaces.idFor()` / `pathHash()`; that ID is also the name of the directory
holding the workspace's generated files.

- `electron/core/appConfig.ts` is the lone layer that persists `roots`,
  `activePath`, `collections`, and `autoTag` to `<userData>/config.json`.
- `electron/core/workspaces.ts` reads the config and caches a `Core` per ID. It
  distinguishes `active()` (the active workspace) from `byId()` (any workspace by
  ID). Code that opens files should be deliberate about which it needs — the
  media server, for instance, resolves by ID so it does not depend on the active
  selection.
- `electron/core/index.ts` defines `Core`, which holds one workspace's `db`,
  `root`, and `dataDir`.
- `electron/core/paths.ts` resolves the storage layout; see
  [Data Model](data-model.md#storage-layout).

### The virtual "All" workspace

`All` (`ALL_ID`) is a logical view that searches across every registered
workspace. It has no database of its own;
`electron/core/crossWorkspace.ts` merges, sorts, and paginates the per-database
query results from each `Core` in memory (a single-workspace set takes a fast
path that skips merging). Scanning never targets `All`.

### Folders

A workspace's subfolders are never stored. The "show by folder" option
derives them from `files.rel_path` on every request
(`electron/core/queries/folders.ts`), so moves, renames, exclusions and rebuilds
need no bookkeeping.

- **Path form.** Over IPC and in the renderer a folder is a `/`-separated path
  relative to the workspace, with the root as `""` (`shared/folderPath.ts`,
  validated by `FolderPathSchema`). `rel_path` itself comes from
  `path.relative()` and uses the OS separator, so the main process converts at
  the SQL boundary and nothing else splits on `\`.
- **Range, not LIKE.** "Under `Movie`" is the half-open range
  `["Movie/", "Movie0")` — `0` being the code point after `/`
  (`electron/core/queries/folderRange.ts`). Ending the prefix at the separator
  keeps a sibling such as `Movies` out, needs no escaping of `%` and `_`, and
  stays on `idx_files_alive_rel_path`. Direct children add
  `instr(substr(rel_path, start), sep) = 0`; `start` is counted in code points,
  as SQLite's `substr()` counts characters.
- **Pinned index.** Workspace databases are never `ANALYZE`d, and without
  statistics SQLite prefers `idx_files_alive` (`deleted_at IS NULL`) over the
  range — a walk over every live file, per child folder for the mosaic. The
  folder queries therefore name `INDEXED BY idx_files_alive_rel_path`.
- **Channels.** `folders_list` returns a folder's child folders (with recursive
  counts and up to four preview files each) and its direct file count; a folder
  with no live files left resolves to its nearest ancestor that has some.
  `folder_files` expands selected folders into their files for a bulk edit,
  spending one `MAX_BULK_FILES + 1` row budget across the call. The file list
  itself is the ordinary `files_search` with `SearchQuery.folder`
  (`{ path, recursive }`). All three run on the query worker. So does
  `files_by_ids`, which the selection reads itself again through after a bulk
  edit: it takes the edit's per-workspace targets and returns the list rows of
  those that still exist. A file that is gone is left out, while a workspace
  that cannot be read fails the call, so "not read" is never taken for "gone".
- **Scope.** Folders exist inside one real workspace only. The renderer does not
  offer the "show by folder" option over `All` or a collection; showing a
  folder from elsewhere (a file's detail, a saved search) switches to its
  workspace first.

### Graph view

The graph view draws the current list — any workspace, `All` or a
collection, with the search and filters applied — as a network of files and
the tags they carry. It is built in one call and cached per scope.

- **One payload.** `graph_build` runs on the query worker
  (`electron/core/graph/buildGraph.ts`). Per database it reads the matching
  files in the list's order (`queries/graph.ts`, which reuses files_search's
  `appendSearchConditions`) up to a cap (`GRAPH_MAX_FILES`, 5,000; the payload
  says when it cut), then asks each edge source for relationships among them.
  Several databases merge with the same comparator as the `All` list
  (`comparatorFor`), and a collection sorted by hand keeps its stored order.
  Identical copies are collapsed before the cap, so they do not take places
  meant for other files. Each file also carries its play count (its
  `play_history` rows, all time, one grouped query per database), which the
  renderer can size nodes by.
  The result is column-oriented (`shared/ipc/graph.ts`): a handful of arrays
  rather than one object per node, so thousands of files cross IPC cheaply.
- **Bipartite.** Files link to tags, not to each other, so the edge count grows
  with the number of (file, tag) pairs rather than the square of the files.
  Same-named tags of different workspaces are one node, which is what links
  files across roots in `All`. Identical copies inside one workspace (one
  `meta_key`) are one node. Generated tags (`namespace <> ''`) are included and
  flagged; the renderer hides them by default.
- **Edge sources.** Relationships come from `EDGE_SOURCES`
  (`electron/core/graph/edgeSources.ts`); tags are the only one today. A new
  kind of relationship — AI similarity as weighted file-to-file kNN edges, say
  — is one more `EdgeSource` (its `build()` returns `kind: "file-file"` with a
  `weight` per edge), a wider `EdgeSourceId`, a row in the renderer's
  `EDGE_SOURCE_INFO` for its label, toggle and legend line, and its own look in
  `GraphCanvas`'s edge reducer (which today draws every kind alike). The
  payload and the toggles already carry kinds and weights (the simulation
  uses the links, not their weights, as Obsidian's does). A source
  sees one workspace at a time, so it can link files within a workspace; links
  across workspaces would need the builder to hand it every workspace at once.
- **Layout cache.** Node positions are derived data, kept as JSON beside the
  data rather than in the database (`electron/core/graph/layoutCache.ts`,
  channels `graph_layout_get` / `graph_layout_set`). A real workspace's file is
  `<userData>/roots/<hash>/graph-layout.json`, deleted with the workspace;
  `All` and collections use `<userData>/graph-layouts/<sha1(scope)[:16]>.json`,
  and a collection's goes with it. Node keys are `f:<workspaceId>:<meta_key>`
  and `t:<namespace>:<name>`, so a position survives moves, renames and
  rescans. A save merges into the file (a filtered graph saves only what it
  shows), is atomic, and runs off the main thread's event loop (async file
  I/O, saves to one file queued so none loses the other's keys); a malformed
  file reads as none. The 3D view keeps its own file per scope
  (`graph-layout-3d.json`, or the hash of `<scope>#3d`), with three numbers
  per key; a file of the other dimension reads as none.

### Heatmap

The heatmap ("Contribution graph" in the UI) is a panel over the list that
counts it — any workspace, `All` or a collection, with the search and filters
applied, within the folder shown under the folder view — per calendar day.

- **One query per database.** `activity_days` runs on the query worker
  (`electron/core/activityDays.ts`) with files_search's target resolution, and
  sums the per-database counts (`queries/activity.ts`, which reuses
  `appendSearchConditions`). A request names a metric and a range of days
  (at most `ACTIVITY_MAX_DAYS`); only days with something on them come back.
- **Metrics.** `played` counts the files with a `play_history` row that day,
  `captured` dates a file by `captured_at`, `created` by `btime`, and `added`
  by `created_at`. A file whose column is NULL is on no day, and a file counts
  once per day however often it was played.
- **A day is a date range.** Each metric has a pair of `SearchQuery` range
  fields (`ACTIVITY_RANGE_FIELDS`: `playedFrom`/`playedTo`, `capturedFrom`/
  `capturedTo`, `btimeFrom`/`btimeTo`, `addedFrom`/`addedTo`) testing the same
  column the counts read. Picking a day, or dragging across several, sets that pair, so a cell's number is
  the length of the list the range gives (identical copies included, as the
  list shows them), which `activityDays.test.ts` pins per metric. The counts
  drop the shown metric's own pair from the query; other metrics' ranges
  narrow them like any condition. A folder scope in the query is kept (a
  collection, which has no folder view, drops it as `files_search` does).
- **Local days, one calendar.** Days cross IPC as `YYYY-MM-DD` strings
  (`shared/day.ts`) and are resolved in the main process's time zone, so the
  renderer never sends timestamps. The SQL only selects timestamps in the
  range; they are put into days in JavaScript, against the same local
  midnights a picked day's range is built from. SQLite's `'localtime'` is
  deliberately not used: it does not agree with `Date` for every year or on
  every platform, and a file would land in a cell whose list leaves it out.

## Collections

Two unrelated mechanisms group files. They differ in where they persist and who
owns them, so keep them distinct.

### User collections

Manually curated virtual folders that span workspaces. They are stored in the
`collections` array of `<userData>/config.json` (see `UserCollectionConfig` in
`electron/core/appConfig.ts`), and each item references a file by
`workspaceId + fileId`. The main process is the source of truth, manipulated
through the `collection_create` / `collection_remove` / `collection_reorder` /
`collection_reorder_items` / `collection_set_emoji` / `collection_rename` /
`collection_add_file` / `collection_remove_file` IPC channels. Note the two
distinct reorderings: `collection_reorder` orders the collections themselves,
while `collection_reorder_items` orders the files inside one — that item order
is what the `manual` sort reads. The UI lives in
`src/components/WorkspaceRail.tsx` and related components.

### Smart collections

Saved searches: a named `SearchQuery`. These never touch the main process —
they persist in the renderer's `localStorage` (`SMART_COLLECTIONS_KEY`). The
schema and normalization live in `src/lib/smartCollections.ts`, the hook in
`src/hooks/useSmartCollections.ts`, and the UI in
`src/components/SmartCollectionsMenu.tsx`. A query is passed through
`cleanSearchQuery()` to drop empty fields before it is stored. A folder below
the root is kept as `folder: { path, recursive: true }` and saved together with
the collection's `workspaceId`, since a folder path means nothing outside its
own workspace; a folder with no workspace to place it in is dropped. Opening
such a search switches to that workspace and browses the folder by folder.

One saved search can be marked as the default (the star in the menu; its id is
stored under `DEFAULT_SMART_COLLECTION_KEY`, apart from the collections). Its
conditions and sort become Home's initial filter at launch
(`loadInitialFilter()`), and "Clear all" returns to them — or empties the
filter once it already shows exactly them (`clearAllTarget()` in
`src/lib/searchConditions.ts`); removing the sort chip restores its sort. The
default applies in every workspace, so its folder and a manual sort, both
bound to one place, are left out (`defaultQueryOf()`). The hook is owned by
`FilterBar`, which passes it to the menu, so the menu and "Clear all" read the
same state.
