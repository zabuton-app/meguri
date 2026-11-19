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
- **Do not move to an Electron major that Arch does not ship yet.** The AUR `meguri` package builds from source against Arch's system Electron (`electronNN` in `extra`; check with `pacman -Si electronNN` or [archlinux.org/packages](https://archlinux.org/packages/?q=electron)). Moving ahead of it leaves that package unable to update, as Electron 45 did (#574). This includes Dependabot's major-update PRs for `electron`: leave them open until Arch has the version.
