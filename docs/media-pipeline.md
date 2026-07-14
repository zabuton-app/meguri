# Media Pipeline

This document covers how files get into the database (the scan pipeline) and how
their bytes reach the renderer (the media server). Both depend on the bundled
ffmpeg/ffprobe binaries, whose path resolution is described at the end.

## Scan pipeline

`runScan()` in `electron/core/jobs.ts` drives the pipeline:
walk → `syncFiles` → thumbnail/metadata extraction (via a parallel pool),
reporting progress through a callback. The main process fires a scan with
`startScan()` whenever a workspace is added, switched to, or re-scanned.

### Walk and incremental sync

`electron/core/scan.ts` walks the directory tree and reconciles it with the
database. It tracks moves and renames via `content_hash` and decides what changed
incrementally from `mtime` and `size`, so unchanged files are skipped and a moved
file keeps its identity (and therefore its metadata — see
[`meta_key`](data-model.md#metadata-and-meta_key)).

### Metadata and thumbnails

`electron/core/media.ts` extracts metadata with ffprobe and generates thumbnails
with ffmpeg, written as WebP.

### Concurrency

`electron/core/concurrency.ts` provides `pool()`, a bounded parallel worker that
supports cancellation via `AbortSignal` while idle. The main process guards
against concurrent scans of the same workspace with the `scanningWs` set, which
avoids chunked-transaction conflicts.

## Media server

`electron/core/server.ts` runs a local HTTP server bound to `127.0.0.1`. URLs
have the form:

```text
/ws/<workspaceId>/<kind>/<fileId>
```

where `kind` is `thumb`, `media`, or `frame`. The server resolves the workspace
by ID (not the active selection), so playback is independent of which workspace
is currently focused.

### Range streaming

`mp4` / `m4v` / `mov` / `webm` are served as raw files with HTTP Range support,
giving full seeking.

### On-the-fly remux

Containers Chromium cannot demux — `REMUX_CONTAINERS` = `mkv` / `avi` / `wmv` /
`flv` / `ts` — are remuxed to fragmented MP4 on the fly
(`-movflags frag_keyframe+empty_moov+default_base_moof`). Time seeking uses a
`?t=<seconds>` query parameter. Chromium-unsupported still images (`heic` /
`heif` / `tiff`, `TRANSCODE_IMAGES`) are transcoded to JPEG.

### Frame previews

A `frame` request returns a single JPEG frame at `?t=<seconds>`, used for seek
previews.

### Authorization

Requests must carry an `X-Api-Token` header. The Electron session injects it for
in-app media loads, so renderer code does not handle it directly.

### ffmpeg/ffprobe path resolution

The bundled ffmpeg/ffprobe binaries are unpacked from the asar archive at
runtime: `electron/core/ffmpeg-paths.ts` rewrites `app.asar` to
`app.asar.unpacked` in the binary paths. This is the only place that rewrite
should happen. The corresponding electron-builder `asarUnpack` configuration is
covered in [Build and CI](build-and-ci.md#packaging).
