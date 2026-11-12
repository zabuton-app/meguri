---
paths:
  - "src/**"
---

# Renderer

See [docs/renderer.md](../../docs/renderer.md) and [docs/theming.md](../../docs/theming.md).

- **i18n**: when adding a translation key, add it to every locale in `src/i18n/locales/`. `ja.ts` defines the `TranslationKey` type. Write `{app}` for the app's name, never "Meguri": `t()` fills it in.
- **Routes**: the routes under `/` (file details, settings, tags…) are children of Home and open as modals over the mounted list.
- **UI primitives** are in `src/components/ui/` (Radix + class-variance-authority). Confirmations use `useConfirm`.
- **Zoom** uses `webFrame.setZoomFactor` through preload, never CSS `zoom`.
- **Theme variables** are declared on `html[data-theme="<id>"]`, so `:root` cannot override them.
