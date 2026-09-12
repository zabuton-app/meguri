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
stays mounted underneath.

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
