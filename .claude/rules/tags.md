---
paths:
  - "shared/tags.ts"
  - "shared/autoTag.ts"
  - "electron/core/tag*.ts"
  - "electron/core/autoTag*.ts"
  - "electron/core/autoMetaTags.ts"
  - "electron/core/crossWorkspace.ts"
  - "electron/core/jobs.ts"
  - "electron/core/graph/**"
  - "electron/ipc/tags.ts"
  - "electron/autoTagWorker.ts"
  - "src/**/*Tag*.{ts,tsx}"
  - "src/routes/Tags/**"
  - "src/routes/AutoTag/**"
---

# Tags and auto tagging

See the tag and Auto tagging sections of [docs/data-model.md](../../docs/data-model.md).

- **Compare tag names with `tagIdentityKey()`** (`shared/tags.ts`; `tag_key()` in SQL), in the main process and the renderer alike. Case, whitespace and invisible characters do not make a different tag. `UNIQUE(namespace, name)` tells spellings apart, so never look up a manual tag with `name = ?` or compare names with `===`.
- **Call `syncFts()` after changing a file's tags.**
- **User regexes never run on a main thread**, in either process: the main process uses `electron/autoTagWorker.ts`, the renderer `src/routes/AutoTag/rules.worker.ts`. A runaway pattern would freeze the app.
