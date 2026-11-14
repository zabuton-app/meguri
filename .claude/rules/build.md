---
paths:
  - "electron.vite.config.ts"
  - "electron.vite.shared.ts"
  - "package.json"
  - ".github/workflows/**"
---

# Build and CI

See [docs/build-and-ci.md](../../docs/build-and-ci.md).

- **preload is built as CommonJS (`.js`)**; an ESM preload can fail to load. `electron/app.ts` resolves preload and the workers with `__dirname`. A new worker must also be added to the main entries in `electron.vite.shared.ts`.
- **better-sqlite3 and @zabuton-app/ffmpeg-binaries** are in `asarUnpack`.
- **@zabuton-app/ffmpeg-binaries downloads ffmpeg and ffprobe for one arch** at install time, so CI pins `npm_config_arch` to the target arch. Its tarball URL is in `package.json` twice (`dependencies` and `allowScripts`); change both together.
- **`build.yml`** runs `test.yml` as a reusable workflow before building, and creates a draft release only for `v*` tags.
