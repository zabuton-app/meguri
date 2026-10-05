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

## Pet

The pet (`src/components/pet/`) is a pixel-art zabuton that lives in the
window. `Pet.tsx` is mounted in Home, below the routed modals in the stacking
order, so a modal's backdrop covers it; it rests (no timers, no frame loop,
`inert`) until the list is back in the foreground.

- **Art**: `petSprites.ts` holds every frame as a text grid, one character per
  pixel naming a color role. `petRender.ts` turns a grid into rects and maps
  roles to colors; only the outline follows the theme's appearance.
  `npm run pet:preview` serves `tools/pet-preview`, which draws every state
  through the same conversion.
- **Behaviour**: `petMachine.ts` is a pure reducer. Held or falling comes
  first, then a queue of one-shot reactions, then the app-driven poses (a file
  drag in progress, a scan running), then idle / walk / sleep.
- **Movement**: `petMotion.ts` is pure too. The floor is the bottom edge of
  Home's `<main>` (`LIST_MAIN_ID`), so it sits above the status bar, rises with the audio player
  bar and gives way to the docked side peek. The position is saved as a ratio
  of the floor's span (`meguri.pet.x`).
- **Actions**: the context menu opens Discover through Home's handler and the
  player through the playlist's URL helpers; "Play Watch Later" shows the
  collection first, the way the rail does. Files dropped on the pet go through `useAddFilesToCollection`, the
  same write as the rail's Watch Later entry. "Bring me something"
  (`petBring.ts`) draws a category, then a file through `files_random`.

Whether the pet is out and its size are preferences (`petVisible`,
`petSize`). With reduced motion preferred it neither walks nor bounces and
shows one frame per state.

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

A selected row is a snapshot, kept even when the list no longer holds it (a
picked folder's files, a row scrolled out, a row the edit itself filtered
away). The list refetch after a bulk edit renews only the rows still loaded,
so the edit also has the selection read itself again (`refresh`): the selected
rows through `files_by_ids` and the picked folders through `folder_files`. A
file that does not come back is gone and leaves the selection. The selection
can be larger than one call may name, so the rows are read in runs of
`MAX_BULK_FILES` (`readInBulkBatches`), all of which must succeed.

The heatmap (`src/heatmap/`, "Contribution graph" in the UI) is not a view but
a panel under the filter bar, over whichever view is shown, toggled from the
filter bar (beside the favorites button) or the command menu and remembered in
`HEATMAP_OPEN_KEY`. It draws a
year of days as week columns, each cell shaded by how many of the files the
list would hold fall on that day (`activity_days`; see docs/architecture.md,
"Heatmap"). What a day counts is a metric — played, captured, created or
added — remembered in `HEATMAP_METRIC_KEY`. The page is the 53 weeks ending
today or one calendar year (`calendar.ts`, which also picks the shade: a
square-root scale against the busiest day shown, so one large import does not
flatten the rest). The week columns share out the full width, so the cells
grow with the window; below a minimum width the grid scrolls sideways instead.

Picking is an edit of the filter, not state of the panel: a click sets the
date range of the metric shown to that day, and a drag across cells sets it to
the days between where it started and where it was let go (`pickedDays.ts`,
`ACTIVITY_RANGE_FIELDS`) — the same condition "More conditions" offers as a
date range. So the days have the range's chip, show in the panel's inputs, are
carried by a saved search, narrow the graph as well as the lists, and a range
typed in the panel marks its cells. A drag is shown as it goes and written on
release (caught on the window, so it may end outside the grid; Escape gives it
up); a press that goes nowhere is a click, and on the one day picked it lets
that day go. Shift extends from the first day picked, which is also the
keyboard's way to a range (Shift+Enter). The counts leave the shown metric's
own range out — with it, only the picked days would have anything on them.
Changing the metric leaves the filter alone: a range already set stays a
condition, named by its chip, and narrows the new counts. Under the folder
view the counts cover the folder shown and everything below it, which is what
the list becomes once a range narrows it. The panel shows the page the range
starts on, and turns to it when the range is set from outside. `Home` keeps
this in `useHeatmapFilter`. The table of date ranges
(`src/lib/dateRanges.ts`) is what the panel of conditions, the chips, a saved
search's description and the fields a saved search keeps all read; a new range
is one row there plus its SQL in `queries/files.ts`. One cell is in the tab
order and the arrow keys move between days; those keys are stopped at the
panel, since the list below listens for them on the window.

The graph view (`src/graph/`, loaded lazily with `React.lazy` so the list views
never pay for it) draws the same list as a network of files and tags, from one
`graph_build` payload (see docs/architecture.md, "Graph view"):

- **Behaviour.** The view follows Obsidian's graph view: the same forces and
  defaults, the same drag, click and zoom, and the same way of drawing. It
  was matched against Obsidian's own renderer and simulation, not copied
  from them.
- **Rendering.** `GraphCanvas` owns one sigma.js (WebGL) instance over a
  graphology graph, framed by a fixed box (`setCustomBBox`) so the view never
  rescales itself as the graph spreads out: the camera works like Obsidian's,
  with `scale` (pixels per graph unit) as the frame's scale over the camera
  ratio. Nodes are discs of radius clamp(3·√(links + 1), 8, 30) graph units
  drawn at √scale (`zoomToSizeRatioFunction`), coloured by kind; links are a
  constant width in pixels (`minEdgeThickness`). Labels sit under their node
  and fade in with the zoom (opacity log2(scale) + 1 − the text fade
  setting), drawn by a custom label drawer. Hovering (or dragging, or picking
  from the graph search) highlights a node: it takes the highlight colour and
  a ring, its label drops a little and always shows, its links take the
  highlight colour, and everything not next to it fades to 20% (mixed into
  the background, since sigma blends colours as premultiplied). The wheel
  zooms by 1.5× a notch toward the pointer, eased over a few frames, between
  scales 1/128 and 8; a resize keeps the scale. The colours are the theme's
  `--c-*` values read by `useGraphColors`, since WebGL cannot see CSS
  variables. All of this is applied by sigma's node and edge reducers from
  state held in a ref. A WebGL failure swaps the canvas for a notice
  (`GraphErrorBoundary`). The canvas takes only the pointer, so the graph
  search is the keyboard's way in: Enter picks a match, Shift+Enter opens it
  as a click does, and Enter on an empty search opens the picked node.
- **A graph per payload.** Each payload builds a new graphology graph that
  takes over the previous one's positions by key (`model/buildGraphology.ts`),
  and the one sigma instance (`GraphView` is keyed by scope in Home) switches
  to it with `setGraph`, keeping the camera. Building a fresh graph rather than
  trimming the shown one matters: sigma v3 re-indexes the whole graph on every
  dropped node or edge, so removing thousands after a filter change would
  freeze the view. For the same reason sigma settings are only set when their
  value changes. Nodes a filter takes out of the data remember where they
  stood and come back there. `graph_build` is invalidated next to
  `files_search` (scan done, tag edits).
- **Simulation.** What is visible is what is simulated: every change of the
  data or the toggles reloads the simulation with the visible nodes and links (unless nothing shown changed). It is d3-force's
  model with Obsidian's forces (`sim/physics.ts`): forceX / forceY toward the
  origin, forceLink at d3's default strength (1 / the smaller degree) times
  the link force, a Barnes-Hut many-body force (θ 0.9, minimum distance 30),
  forceCollide (radius 60, strength 0.5) and a velocity decay of 0.6. It runs
  in a Web Worker (`sim/sim.worker.ts`, driven by `SimClient`) that ticks at
  60 Hz while alpha cools from its last reheat (1 for a mostly new graph, 0.3
  for a change) to 0.001, about 300 ticks, and posts each tick's positions,
  applied once per animation frame. The tick itself is WebAssembly
  (`assembly/forces.ts`, AssemblyScript, in 2 or 3 dimensions: a port of
  d3-force-3d, which in 2D is d3-force). For 5,000 files on the development
  machine it takes about 7 ms per tick in 2D and 11 ms in 3D, against 18 and
  40 for the JavaScript libraries. d3-force-3d is the fallback where
  WebAssembly cannot start; the two give identical results, which a test
  checks bit for bit in both dimensions.
  The module is compiled by `npm run build:wasm` into
  `src/graph/sim/forcesWasm.ts` (base64, so the worker needs no fetch from
  `file://`), and a test fails when that file is older than the source.
  WebAssembly compiles in the worker only: the page's CSP would need
  `'wasm-unsafe-eval'`, a module worker's does not.
- **Placement.** A node shown for the first time takes where it last stood,
  else its cached position, else Obsidian's seat for a newcomer
  (`model/placement.ts`): near the centroid of its seated neighbours with a
  jitter that grows with the number of newcomers, else in a ring outside the
  nodes already there. The camera frames the graph when it first has nodes,
  and once more when a fresh layout first settles unless the user has moved
  the camera. Positions are saved per scope when the simulation cools down
  (debounced, and on unmount); "Re-layout" seats every visible node afresh.
- **Dragging and clicking.** A press that moves 5 pixels is a drag
  (`GraphCanvas`); anything less is a click, and the release of a drag is not
  taken for one. A drag pins the node under the pointer and keeps the whole
  simulation warm (alpha and its target at 0.3) so everything linked to it
  follows; on release the pin goes and the graph cools down. A drag outlives a
  refetch. A click opens: a file in the detail (as a modal or the side peek),
  a tag as the list's filter. Holding the right button down pans the view,
  over nodes too (sigma pans with the left button only, and on a node that
  drags it); the canvas has no context menu.
- **3D view.** A "2D / 3D" switch (stored in
  `localStorage["meguri.graph.dims"]`) shows the same graph in three
  dimensions (`GraphCanvas3D`, three.js, loaded only when first used). The
  two lay a graph out differently, so each keeps its own layout cache and
  switching remounts the view. The simulation, forces, placement (a shell
  instead of a ring), filters, search, settings and sizing are
  shared; the 3D canvas takes the same props and handle as the flat one.
  - Nodes are one instanced sphere mesh and links one set of translucent
    line segments, so thousands of each cost two draw calls. Fog toward the
    background colour gives depth.
  - Sizes, colours, fading and labels follow the flat view's rules, with
    scale taken as pixels per graph unit at a node's depth: nodes are drawn
    at √scale of the orbit target, and labels fade in by the same formula.
    Link thickness does not apply (WebGL lines are one pixel).
  - Picking and labels work in screen space: visible nodes are projected
    once per frame, and the nearest 400 get a label.
  - Left drags a node across the plane facing the camera, or orbits from
    the background; right pans; the wheel zooms toward the pointer; a click
    without movement opens a node.
- **Settings.** The settings panel has Obsidian's Display (text fade
  threshold, node size, link thickness) and Forces (centre, repel, link force,
  link distance) sliders, stored as slider positions in
  `localStorage["meguri.graph.settings"]` (`graphSettings.ts`) and mapped to
  the physics with Obsidian's curves: centre and link force ease in
  exponentially, repel is the cube of its slider. A change of forces reheats
  the simulation to 0.3. Display also chooses what node size follows: the
  visible links (Obsidian's default) or how often the file was played or
  viewed (the payload's `plays`; a tag weighs the plays of its visible
  files), through the same radius formula (`nodeWeights`). Recording a play
  invalidates `graph_build`, so sizes follow.
- **Pure model.** Visibility (toggles, orphans),
  search, placement and node appearance are plain functions under
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
