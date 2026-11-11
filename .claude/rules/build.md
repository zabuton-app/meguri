---
paths:
  - "electron.vite.config.ts"
  - "package.json"
  - ".github/workflows/**"
---

# Build and CI

See [docs/build-and-ci.md](../../docs/build-and-ci.md).

- **preload is built as CommonJS (`.js`)**; an ESM preload can fail to load. `electron/main.ts` resolves preload and the workers with `__dirname`. A new worker must also be added to the main entries in `electron.vite.config.ts`.
- **better-sqlite3, ffmpeg-static and @derhuerst/ffprobe-static** are in `asarUnpack`.
- **ffmpeg-static and ffprobe-static download one binary for one arch** at install time, so CI pins `npm_config_arch` to the target arch.
- **`build.yml`** runs `test.yml` as a reusable workflow before building, and creates a draft release only for `v*` tags.
