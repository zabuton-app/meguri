---
paths:
  - "electron/**"
---

# Main process

See [docs/architecture.md](../../docs/architecture.md) and [docs/media-pipeline.md](../../docs/media-pipeline.md).

- **Settings**: write them only through `updateConfig()` in `electron/core/appConfig.ts`, changing just your own fields of the stored value it hands you. Writing back a snapshot reverts what other owners changed (#223). They live in the library's `app_settings` table; `config.json` is only imported once from older versions.
- **Scans** start through `ScanManager` (`electron/scanManager.ts`), which keeps one scan per workspace at a time.
- **Other writes across all workspaces** (such as applying auto tags to existing files) go through `WorkspacePasses` (`electron/core/workspacePasses.ts`), so removing a workspace or quitting stops them before the DB closes.
- **ffmpeg/ffprobe paths** come from `electron/core/ffmpeg-paths.ts`, which handles `app.asar.unpacked` and the system FFmpeg a package names with `MEGURI_FFMPEG_DIR`.
