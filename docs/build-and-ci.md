# Build and CI

This document covers the npm scripts, the electron-vite build, the two-project
test setup, packaging, continuous integration, and Docker-based development.

## npm scripts

```bash
npm install        # postinstall rebuilds better-sqlite3 for Electron
npm run dev        # development mode (electron-vite dev)
npm run build      # build main / preload / renderer into out/
npm run preview    # launch the built app (= npm start)
npm run dist       # produce distributables (electron-builder)
npm run typecheck  # tsc --noEmit over both src and electron
npm test           # regression tests (Vitest): core then renderer
npm run install:local  # install into the local environment
```

`dev`, `preview`, and `start` go through `scripts/run-electron-vite.mjs` rather
than calling `electron-vite` directly. The wrapper strips
`ELECTRON_RUN_AS_NODE` (which the test runner sets) from the environment before
launching, so Electron does not accidentally start in node mode.

## electron-vite config

`electron.vite.config.ts` builds main, preload, and renderer from one config.

- Preload is emitted as **CommonJS** (`.js`); ESM `.mjs` preload can fail to
  load, and `registerIpc`'s `__dirname` reference assumes CJS output.
- TypeScript uses separate tsconfigs for `src` and `electron`, both `strict` with
  `noUnusedLocals` / `noUnusedParameters`.

## Testing

Tests run under Vitest (`vitest.config.ts`) as two projects.

### Core project

`npm run test:core` covers the main/core logic (`electron/**/*.test.ts`). Because
better-sqlite3 is built for Electron's ABI, this **runs Electron as Node**
(`ELECTRON_RUN_AS_NODE=1` plus `--experimental-require-module` to allow
`require()` of ESM). It exercises real SQL against an in-memory SQLite database.
The config carries a plugin that resolves NodeNext-style `.js` import specifiers
to `.ts`.

### Renderer project

`npm run test:renderer` covers the renderer (`src/**/*.test.{ts,tsx}`, jsdom).
With no native dependency it runs under plain Node; it is kept separate because
the jsdom worker does not start under Electron's experimental loader.

## Packaging

`npm run dist` runs `electron-vite build` then `electron-builder`. The builder's
`asarUnpack` includes better-sqlite3, ffmpeg-static, and ffprobe-static; code
that uses ffmpeg paths must apply the `app.asar` → `app.asar.unpacked`
substitution (see
[ffmpeg/ffprobe path resolution](media-pipeline.md#ffmpegffprobe-path-resolution)).

Distribution targets are Linux (AppImage / deb), Windows (nsis / portable), and
macOS (dmg / zip).

## CI

GitHub Actions workflows live in `.github/workflows/`:

- `test.yml` runs `npm run typecheck` and `npm test`.
- `build.yml` triggers on `v*` tag pushes and builds a four-way matrix (linux
  x64, win x64, mac arm64, mac x64), then creates a release.

ffmpeg-static fetches a single-architecture binary at install time, so CI pins
`npm_config_arch` to the target arch to keep the bundled binary consistent.
ffprobe-static ships all platforms and is resolved at runtime, so it needs no
pinning.

## Docker development

Development can also run in Docker (Wayland assumed):

```bash
docker compose up
```

`HOST_MEDIA_DIR` selects the directory to scan, and `RENDER_GID` / `VIDEO_GID`
set the GPU groups via `.env` (`Dockerfile` / `docker-compose.yml`). The dev
container seeds its initial workspace list from `samples/config.json` via
`scripts/seed-sample-config.mjs`; set `MEGURI_SEED_SAMPLE_CONFIG=force` to reset
to the sample state.
