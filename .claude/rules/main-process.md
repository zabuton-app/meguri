---
paths:
  - "electron/**"
---

# Main process

See [docs/architecture.md](../../docs/architecture.md) and [docs/media-pipeline.md](../../docs/media-pipeline.md).

- **Config**: write `<userData>/config.json` only through `updateConfig()` in `electron/core/appConfig.ts`, merging just your own fields into the latest value on disk. Writing back a snapshot reverts what other owners changed (#223).
- **Scans** start through `ScanManager` (`electron/scanManager.ts`), which keeps one scan per workspace at a time.
- **Other writes across all workspaces** (such as applying auto tags to existing files) go through `WorkspacePasses` (`electron/core/workspacePasses.ts`), so removing a workspace or quitting stops them before the DB closes.
- **ffmpeg/ffprobe paths** come from `electron/core/ffmpeg-paths.ts`, which handles `app.asar.unpacked`.
