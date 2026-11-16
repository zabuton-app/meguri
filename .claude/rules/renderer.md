---
paths:
  - "src/**"
---

# Renderer

See [docs/renderer.md](../../docs/renderer.md) and [docs/theming.md](../../docs/theming.md).

- **i18n**: when adding a translation key, add it to every locale in `src/i18n/locales/`. `ja.ts` defines the `TranslationKey` type. Write `{app}` for the app's name, never "Meguri": `t()` fills it in. Pass counts and other numbers to `t()` as numbers: it formats them for the app's language and picks a `{count}` string's plural form (`{ one, other }` objects in the locales other than `ja`).
- **Routes**: the routes under `/` (file details, settings, tags…) are children of Home and open as modals over the mounted list.
- **UI primitives** are in `src/components/ui/` (Radix + class-variance-authority). Confirmations use `useConfirm`.
- **Long lists**: a list that can grow without bound (loaded page by page, or uncapped) is virtualized with `useVirtualizer` plus `useInfiniteScrollTrigger` (and `useScrollToRow` / `useGridKeyboardNav` for keyboard navigation). A capped list need not be. See "Data fetching" in docs/renderer.md.
- **Zoom** uses `webFrame.setZoomFactor` through preload, never CSS `zoom`.
- **Theme variables** are declared on `html[data-theme="<id>"]`, so `:root` cannot override them.
