# Renderer

The renderer is a React + TypeScript app under `src/`, talking to the main
process over `window.api`. This document covers its routing, provider stack, data
fetching, internationalization, theming, and content zoom.

## Routing

Routing uses `createHashRouter` (`src/App.tsx`); a hash router is the stable
choice inside a webview. `/` (`src/routes/Home/`) is the parent route, and
`file/:id` (`src/routes/MediaDetail/`), `discover` (`src/routes/Discover/`),
`play` (`src/routes/Player/`), `history` (`src/routes/History/`), and
`settings` (`src/routes/Settings/`) are its **children**. Home renders an
`<Outlet />`, so these children mount as modals **on top of** the list, which
stays mounted underneath. The file detail can alternatively dock as a **side
peek** — a sheet docked beside the list as a flex sibling, so the list narrows
and stays fully usable along with the toolbar and the bottom player bar
(`MediaModal`'s `presentation` prop). Its left edge is a drag handle; the
choice, the modal size and the peek width are all remembered in
`localStorage`.

Each route is a directory: `index.tsx` is the entry point and composes the
route, sitting alongside its companion components and hooks — for example
`src/routes/MediaDetail/MediaModal.tsx`,
`src/routes/MediaDetail/VideoPlayer.tsx`,
`src/routes/MediaDetail/useDetailMutations.ts` (every write to the file), and
`src/routes/Player/usePlayerKeys.ts` (the playlist's keyboard control). Keep
mechanics in such hooks and components; `index.tsx` should stay a composition.

## Provider hierarchy

The provider stack is set up in `src/main.tsx`:

```text
QueryClientProvider → ThemeProvider → I18nProvider → PreferencesProvider → ConfirmProvider
```

## Audio playback

Audio plays through one `<audio>` element owned by `AudioPlayerProvider`
(`src/audio/AudioPlayerProvider.tsx`), mounted in `App.tsx` outside the router
so a track survives navigation. Every surface that shows audio — the bottom
player bar, the detail stage, the side peek and the playlist stage — only
drives that element; none has audio of its own.

The **spectrum display** (`src/audio/AudioSpectrum.tsx`) draws a live
frequency spectrum of that element on a canvas, in one of twelve patterns
(`src/audio/spectrumPatterns.ts`: bars, a ring, an LED meter, mirrored bars,
an oscilloscope, a filled area, particles, strings, a ridgeline, ripples,
orbs or a barcode — an "Audio" preference) and in a mode
the host picks for its box (over the art, instead of missing art, or inside
the side peek's tile). Hosts read `useSpectrumPattern()` and `PATTERN_LAYOUT`
to place it. Each pattern is a drawer built by `createDrawer()`; the ones with
motion of their own (falling sparks, a receding history) keep
that state per display and report when it has played out, so the frame loop
runs on after the track stops until nothing moves. It reads from a Web Audio
`AnalyserNode` built lazily by `src/audio/analyser.ts` on the first display
that asks for it: one `AudioContext`, one `MediaElementAudioSourceNode` (the
platform allows exactly one per element) and the analyser wired between the
element and the speakers. Two invariants follow:

- The element is loaded with `crossOrigin="anonymous"`. The media server is
  a different origin from the renderer, and an opaque source feeds the
  analyser silence; the server answers with `Access-Control-Allow-Origin: *`.
- Once attached, the graph stays connected for the element's lifetime. The
  tap follows the element's own events: `play` resumes the context (so a
  suspended context cannot silence the track), and a pause or an end suspends
  it a few seconds later so the audio thread does not stay awake for the rest
  of a tray-resident session.

The display is off under the "Audio spectrum" preference and under the OS
reduce-motion setting; where Web Audio is unavailable it draws nothing and
playback is unaffected.

## Data fetching

Data fetching uses `@tanstack/react-query`. The file list is an
`useInfiniteQuery` combined with `@tanstack/react-virtual` for infinite scroll
plus virtualization (`src/components/MediaGrid.tsx`). Three view modes — grid,
list and graph — are switchable.

Both views have a "show by folder" option (`BY_FOLDER_KEY`, remembered apart
from the view mode) that browses one workspace like a file manager: the current
folder's child folders first, then its direct files, with a header above naming
the folder and what it holds (`FolderHeader`). A folder is drawn as a folder —
a tab and a body tinted with the theme's `accent2`, holding a mosaic of up to
four thumbnails (`FolderArt`) — as a card in the grid (`FolderCard`) and in the
thumbnail slot of a row in the list (`FolderRow`). Both views take the folders
as leading entries of their own virtualized rows, and each folder entry keeps
its view's item dimensions, because each view sizes every row from one measured
row. Where the view is is held by `useFolderNav` in memory (per workspace, with
a back stack), not in the URL — Home stays mounted under its child-route
modals, so the location survives opening and closing them, whereas a query
parameter on `/` would be dropped by the first navigation to `/file/:id`. With a
search or filter active, it searches everything below the current folder
instead (`hasFilterConditions`). Browsing a folder, the playlist and Discovery
both draw from its whole subtree rather than the direct files shown: the player
through its own order (`PlaylistNavContext`, in the list's sort or by name),
Discovery through its filter. Both name the folder they draw from
(`FolderScopeChip`, spelled from the workspace down — the workspace alone for
its root). Both buttons are
enabled on the same rule — something to draw from, which by folder is the
listing's direct files plus its child folders' counts. Below the root, the
folder is also read back in the filter bar as a chip (`filterValue` adds it to
the query the bar sees; `onFilterChange` splits it off again), so removing it
or "Clear all" returns to the root and a saved search carries it. The folder
shown in the header opens a menu of its child folders, and a file's detail
view offers "Show folder in library", which turns the option on and moves
there through `showFolderInLibrary` (switching workspace when needed). Such a
request commits only once its workspace is active: switches are serialized, a
removed workspace is refused before `workspace_switch` (which would rescan the
active one instead), and a request overtaken by another request or by another
workspace becoming active is dropped. A move (`useFolderNav().moves`) or a
change of conditions drops it only once it is in its own workspace, since a
switch cannot be taken back. A folder that cannot be resolved is not gone to:
with other conditions the view would only search it, never correct it. Over `All`
or a collection the view is drawn flat (`isFolderView`) without overwriting the
stored option.

Selecting a folder selects every file below it: `SelectionContext` fetches
them through `folder_files` when the folder is picked, because the selection bar
and the bulk tag dialog are computed from rows. Until they arrive the selection
is `pending` and the bulk actions wait; the selection's `count` includes files
beyond the cap so the bar can refuse an oversized edit.

The graph view (`src/graph/`, loaded lazily with `React.lazy` so the list views
never pay for it) draws the same list as a network of files and tags, from one
`graph_build` payload (see docs/architecture.md, "Graph view"):

- **Rendering.** `GraphCanvas` owns one sigma.js (WebGL) instance over a
  graphology graph. Files are discs coloured by kind, tags ringed discs; the
  colours are the theme's `--c-*` values read by `useGraphColors`, since WebGL
  cannot see CSS variables. Highlighting, dimming, hidden kinds and the local
  graph are all applied by sigma's node and edge reducers from state held in a
  ref, so an interaction is a `refresh({ skipIndexation: true })`, never a
  rebuild. Labels are thinned by sigma's label grid; a WebGL failure swaps the
  canvas for a notice (`GraphErrorBoundary`).
- **A graph per payload.** Each payload builds a new graphology graph that
  takes over the previous one's positions by key (`model/buildGraphology.ts`),
  and the one sigma instance (`GraphView` is keyed by scope in Home) switches
  to it with `setGraph`, keeping the camera; the selection survives if its node
  does. Building a fresh graph rather than trimming the shown one matters:
  sigma v3 re-indexes the whole graph on every dropped node or edge, so
  removing thousands after a filter change would freeze the view. For the same
  reason sigma settings are only set when their value changes. Nodes a filter
  takes off the screen remember where they stood and come back there.
  `graph_build` is invalidated next to `files_search` (scan done, tag edits).
- **Placement and layout.** A new node starts at its cached position, else near
  its placed neighbours, else at a spot hashed from its key
  (`model/placement.ts`), so the first frame never waits. ForceAtlas2 then runs
  in a Web Worker (`layout.worker.ts`, driven by `LayoutClient`) in chunks whose
  positions are applied once per animation frame: fully when most nodes are
  new, with the cached ones pinned when few are, not at all when none are.
  Generated tags stay out of the layout and sit at their files' centroid. The
  settled positions are saved per scope (debounced, and on unmount).
- **Pure model.** Visibility (toggles, orphans, the local graph's BFS),
  related-file ranking, search and placement are plain functions under
  `src/graph/model/`, tested without WebGL.
- **Options.** The relationship-kind, generated-tag and orphan toggles persist in
  `localStorage["meguri.graph.options"]`. The graph has no folder form: while it
  shows, `isFolderView` is false and the "show by folder" button is disabled,
  without changing the stored option; the selection bar is not offered.

Toggling a favorite patches both the list and detail react-query caches so they
stay in sync without a refetch. Discover pulls videos with `randomFiles`
(`ORDER BY RANDOM()`) and presents them one at a time as a full-bleed immersive
modal driven by embla-carousel, with a horizontal `SceneRail` of seekable scene
previews. The History route lists `history_list` pages (day-grouped, infinite
scroll) across the active or all workspaces.

Hovering a video thumbnail scrubs through frames fetched from the `frame`
endpoint (`src/hooks/useHoverFramePreview.ts`, shared by `MediaThumbnail` and
the Discover main media); the `hoverPreview` preference in
`PreferencesProvider` toggles it.

Styling is Tailwind CSS v4 (`@tailwindcss/vite`). `@/*` is an alias for `src/*`.

## Internationalization

i18n lives in `src/i18n/` (`I18nProvider` plus `t("key", { params })`, persisted
to `localStorage`). The supported languages are `ja`, `en`, `es`, `fr`, `ko`, and
`zh-CN`, with one file per locale in `src/i18n/locales/`. The key type
`TranslationKey` is defined primarily in `src/i18n/locales/ja.ts`. When adding a
key, sync **all** locales.

## UI primitives and dialogs

UI primitives are in `src/components/ui/` (Radix plus class-variance-authority,
in the shadcn style). Confirmation dialogs use `ConfirmProvider` / `useConfirm`
(`src/components/ConfirmDialog.tsx`).

## Theming

Theming is a base16-based multi-theme system in `src/themes/`, covering schemes
such as gruvbox, solarized, and nord. It has four layers:

- `base16.ts` — the `Base16Scheme` shape only.
- `schemes.ts` — the palettes, kept verbatim from their upstream definitions.
- `derive.ts` — maps base16 slots onto semantic tokens **and enforces contrast
  floors** (`FLOORS`). A base16 palette is not a contrast-checked design system:
  several upstream schemes have non-monotonic ramps (ayu-light's base02 is
  lighter than base01) or repurpose slots for accents (catppuccin-latte's base06
  is salmon), so mapping slots straight onto UI roles produces themes where
  hairlines or even body text disappear. Corrections move only the OKLab
  lightness, so hue and chroma survive, and a color that already clears its floor
  is passed through untouched.
- `ThemeProvider.tsx` — injects one `html[data-theme="<id>"]` block per scheme at
  import time (before the first paint, which is what `public/theme-boot.js`
  assumes) and switches `<html data-theme>`.

Adding a theme means adding its palette to `schemes.ts`; nothing else needs to be
touched. `src/themes/__tests__/derive.test.ts` runs every scheme through the
floors and the hierarchy invariants, so a palette that would break somewhere in
the UI fails there instead of shipping.

## Content zoom

Zoom uses `webFrame.setZoomFactor` rather than CSS zoom, so coordinate math is
not affected. It is driven via `preload` through
`src/hooks/useContentZoom.ts`.
