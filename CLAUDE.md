# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Area-specific rules are in [.claude/rules/](.claude/rules/) and load only when matching files are touched. Personal instructions that should not be shared go in `CLAUDE.local.md` at the repository root (gitignored).

## Project overview

Meguri is a desktop app that lists, searches and plays local videos, images and audio with thumbnails. Electron with a Node/TypeScript main process (`electron/`) and a React/TypeScript renderer (`src/`). The only native dependency is better-sqlite3; ffmpeg/ffprobe are bundled.

The "Architecture" section of [README.md](README.md) is the overview. The developer reference is in [docs/](docs/README.md):

- [docs/architecture.md](docs/architecture.md) — processes, IPC, workspaces, tray, collections, config
- [docs/data-model.md](docs/data-model.md) — schema, migrations, metadata keys, tags, auto tagging
- [docs/media-pipeline.md](docs/media-pipeline.md) — scanning, thumbnails, the media server
- [docs/renderer.md](docs/renderer.md) and [docs/theming.md](docs/theming.md) — the React app, themes, custom CSS
- [docs/build-and-ci.md](docs/build-and-ci.md) — scripts, packaging, CI, Docker

## Language

Everything written to this repository is in **English**: issues, pull requests, commit messages, code comments and documentation.

## Commands

```bash
npm install           # postinstall rebuilds better-sqlite3 for Electron
npm run dev           # development mode (MEGURI_ROOT=/path/to/dir sets an initial scan root)
npm run build         # build main / preload / renderer into out/
npm run typecheck     # tsc --noEmit for src, electron and e2e
npm test              # Vitest: core (Electron as Node), then renderer (happy-dom)
npm run lint          # ESLint
npm run format:check  # Prettier
```

A change is verified with `npm run typecheck`, `npm test`, `npm run lint` and `npm run format:check` (the same checks as CI), plus a manual `npm run dev` for UI changes. Tests are `electron/**/*.test.ts` (core) and `src/**/*.test.{ts,tsx}` (renderer), mostly in `__tests__/` folders.

## Engineering principles

- **YAGNI**: build what the issue asks for, nothing more. No speculative caching, retries, throttling, options or abstractions "just in case".
- **KISS**: prefer the simplest change that meets the requirement. When a review comment would grow the change, check it against the requirement first; decline it with a reason if it is not needed.
- **But do not skip the care that prevents real damage**: data integrity, concurrency, security and behavior when something fails (an unreadable file, an unmounted drive) get the complexity they need. Say why in the pull request.
- **Follow existing patterns** before inventing new ones, and keep each change within its issue. Do not refactor working code without a reason; propose a separate issue instead.
- **Fix the cause, not the symptom.** Reproduce a bug with a failing test first where practical, and keep that test.
- **Never delete or skip a test to make a check pass.**
- **Abstract on the third repetition, not the first.** Two similar pieces of code are cheaper than the wrong abstraction.
- **Comments say why**, not what the code already says.

## Invariants

- The renderer reaches the main process only through `preload` and the typed IPC in `shared/ipc/`.
- The app stays in the tray: closing the window hides it, and only "Quit" (or Cmd+Q on macOS) exits ([electron/app.ts](electron/app.ts)).
- Each workspace (scan root) has its own DB and thumbnails. Code that serves or edits a file resolves the workspace by ID (`byId()`), not by whichever is active (`active()`), unless it really means the active one.

## Releases

Releases are tagged by maintainers; see [CONTRIBUTING.md](CONTRIBUTING.md#releases).
