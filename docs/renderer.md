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

Each route is a directory: `index.tsx` is the entry point, sitting alongside its
companion components — for example
`src/routes/MediaDetail/MediaModal.tsx`,
`src/routes/MediaDetail/VideoPlayer.tsx`, and
`src/routes/MediaDetail/SceneBookmarks.tsx`.

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
frequency spectrum of that element on a canvas, in one of thirteen patterns
(`src/audio/spectrumPatterns.ts`: bars, a ring, an LED meter, mirrored bars,
an oscilloscope, a filled area, particles, strings, a Lissajous figure, a
ridgeline, ripples, orbs or a barcode — an "Audio" preference) and in a mode
the host picks for its box (over the art, instead of missing art, or inside
the side peek's tile). Hosts read `useSpectrumPattern()` and `PATTERN_LAYOUT`
to place it. Each pattern is a drawer built by `createDrawer()`; the ones with
motion of their own (falling sparks, a fading trail, a receding history) keep
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
list, and table — are switchable.

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
