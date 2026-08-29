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
   `register*Handlers()` in `electron/main.ts`. Handlers are grouped by domain
   (for example `registerStatusHandlers`, `registerWorkspaceHandlers`,
   `registerScanHandlers`, `registerFileHandlers`, `registerTagHandlers`,
   `registerBookmarkHandlers`, `registerThumbHandlers`). The output type is
   checked against the channel definition automatically.
5. Add `api.<method>` to `src/ipc/client.ts`. Its input and output types are
   inferred from the channel name.

The preload whitelist is built from `shared/ipc/channelNames.ts` at bundle time,
so it stays in sync without a separate manual list.

## Tray-resident lifecycle

The app lives in the system tray and **does not quit when its window is closed**.
This is an invariant in `electron/main.ts`; preserve it when changing window or
lifecycle behavior:

- The window's `close` event calls `preventDefault()` and hides the window to the
  tray unless `isQuitting` is set.
- `window-all-closed` does **not** call `app.quit()`.
- The app quits only via the tray "Quit" menu item or, on macOS, Cmd+Q; both set
  `isQuitting = true` (the latter through `before-quit`).
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
  `activePath`, and `collections` to `<userData>/config.json`.
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
`cleanSearchQuery()` to drop empty fields before it is stored.
