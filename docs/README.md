# Meguri Developer Documentation

This directory is the architecture reference for people working on Meguri's
source. It explains how the app is put together and why — the mechanisms,
invariants, data flow, and extension procedures behind the codebase.

For what the app is, how to install it, and how to use it, see the top-level
[README](../README.md) and the [library guide](library-guide.md). This set assumes
you have already read the README.

## What's here

- [Architecture](architecture.md) — process boundaries, the IPC type system,
  the tray-resident lifecycle, the workspace model, and collections.
- [Data Model](data-model.md) — the SQLite schema, the `meta_key` design that
  makes user metadata durable, the versionless migration scheme, full-text
  search, and the query layer.
- [Media Pipeline](media-pipeline.md) — the scan pipeline (walk → sync →
  thumbnails/metadata) and the local HTTP media server (Range streaming,
  on-the-fly remux, frame previews).
- [Renderer](renderer.md) — the React app: routing, providers, data fetching,
  internationalization, theming, and content zoom.
- [Build and CI](build-and-ci.md) — npm scripts, the electron-vite build, the
  two-project test setup, packaging, CI, and Docker-based development.

## Where to start

Read in this order for a top-down picture:

1. [Architecture](architecture.md) — the spine; the other docs cross-reference
   it.
2. [Data Model](data-model.md)
3. [Media Pipeline](media-pipeline.md)
4. [Renderer](renderer.md)
5. [Build and CI](build-and-ci.md)

## Relationship to other docs

| Doc                                   | Audience                        | Role                                                       |
| ------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| [README](../README.md)                | Users and first-time developers | Overview, installation, and storage layout.                |
| [Library guide](library-guide.md)     | Users                           | Step-by-step catalogue, filtering, and playback workflows. |
| `docs/**` (this set)                  | Contributors                    | How the code works and why — the architecture reference.   |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contributors                    | Branch model, pull-request flow, and releases.             |

The top-level [README](../README.md) owns installation and the on-disk storage
layout. The [library guide](library-guide.md) owns the user workflows. Keep it in
sync when a control or its behaviour changes; update the corresponding
architecture reference when the implementation changes.
