---
paths:
  - "electron/core/db.ts"
  - "electron/core/queries/**"
  - "electron/core/queries.ts"
  - "electron/core/tags.ts"
  - "electron/core/scan.ts"
  - "electron/core/library.ts"
---

# Database

See [docs/data-model.md](../../docs/data-model.md) for the full schema.

- **No schema version numbers.** Change the schema by editing the DDL in `electron/core/db.ts` (`CREATE TABLE IF NOT EXISTS`) and adding an idempotent `ALTER` to `backfillColumns()` (guarded by `hasColumn()`). Do not use `user_version`.
- **User data is keyed by `meta_key`**, not `files.id`: `file_meta`, `meta_tags`, `scene_bookmarks` and `play_history` survive moves, renames and FTS rebuilds this way.
- Tag names are compared with `tagIdentityKey()`; see `.claude/rules/tags.md`.
