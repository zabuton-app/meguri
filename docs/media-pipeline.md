# Media Pipeline

This document covers how files get into the database (the scan pipeline) and how
their bytes reach the renderer (the media server). Both depend on the bundled
ffmpeg/ffprobe binaries, whose path resolution is described at the end.

## Scan pipeline

`runScan()` in `electron/core/jobs.ts` drives the pipeline:
walk → `syncFiles` → thumbnail/metadata extraction (via a parallel pool),
reporting progress through a callback. `ScanManager` (`electron/scanManager.ts`)
owns the scan state and fires a scan with `start()` whenever a workspace is
added, switched to, or re-scanned; `main.ts` starts the initial scan and aborts
them all on quit.

### Walk and incremental sync

`electron/core/scan.ts` walks the directory tree and reconciles it with the
database. It tracks moves and renames via `content_hash` and decides what changed
incrementally from `mtime` and `size`, so unchanged files are skipped and a moved
file keeps its identity (and therefore its metadata — see
[`meta_key`](data-model.md#metadata-and-meta_key)). A new path counts as a move
only when the match is unambiguous: among the rows with the same hash and size
not seen in this scan, exactly one is live (or, when none is live, exactly one
is soft-deleted). When identical copies disappear together, the file is
inserted instead of taking over a copy's id at random; its metadata still
follows through the shared hash.

A root that cannot be read (an unplugged drive, a share that is down) fails the
scan before the index is touched, so its files are not soft-deleted, and the
user is told which workspace's folder could not be reached. The root is
read again at the end of the walk, so one that goes away partway through fails
the scan too, instead of its folders reading as deleted (a subfolder or file
that turns out to be gone triggers the same check right away).

An unmounted mountpoint (an `/etc/fstab` entry whose drive is not attached) can
be read, as an empty folder, so each scan records whether the root is a
mountpoint: on another device than its parent folder (only those two are
compared, since a network share can get a new device id on every mount). A root
that was one at the last scan, is on its parent's device now and holds no media
fails the scan the same way (whatever else the bare folder holds, such as a
desktop's hidden file, does not count), and so does a root mounted or unmounted
while it is walked. A drive unmounted during the thumbnails is reported the same
way rather than as a broken ffmpeg. An existing workspace is covered from its
first scan with the drive mounted.

A rebuild resets the index only after the root has been read. It soft-deletes
the rows (clearing their probed fields, thumbnails and search entries) instead
of deleting them, so the rescan revives each file still there with the same
`files.id`; rows of files already gone are deleted. The rescan
hashes every file, so content replaced with its size and mtime kept is caught as
a change; an unchanged file is not auto-tagged again, which "Apply to existing
files" on the auto-tag screen does. A subdirectory that cannot be listed, or a
file that cannot be stat'ed, is skipped: its rows are kept as they are, with
their IDs and thumbnails, by a rebuild too (not soft-deleted, not taken over by
move detection, and not sent to thumbnail generation).

A file whose content cannot be read for hashing (permission denied, locked by
another process, removed since the walk, shrunk while it was read) is skipped
for that scan instead of failing it: a new file is not inserted, and an
existing row is left as it is (not updated, not soft-deleted). The next scan
tries it again. One exception:
when a file was moved or renamed to a path that cannot be read, the move is not
detected, so the row at the old path is soft-deleted; once the new path is
readable, the next scan detects the move and revives that row with its ID and
metadata. The scan log
records only how many files were skipped, by error code, not their names.

Both kinds are counted in the scan's `stats.skipped`, and the renderer shows a
warning with that count and the workspace's name after a scan, automatic or
not, since nothing else would show them; a startup scan that ends before the
window listens is not reported, and the next scan reports the same items. It
does not list the paths. The walk does not descend into `node_modules` or into
the folders a file system keeps at a drive's root (`lost+found`,
`System Volume Information`, `$RECYCLE.BIN`).

### Metadata and thumbnails

`electron/core/media.ts` extracts metadata with ffprobe and generates thumbnails
with ffmpeg, written as WebP.

For audio the thumbnail is the file's embedded cover art (ID3v2 `APIC`, MP4
`covr`, FLAC `METADATA_BLOCK_PICTURE`). `coverArtStreamIndex()` finds it in the
already-probed ffprobe JSON via each stream's `disposition.attached_pic` flag,
rather than assuming that any video stream in an audio file is artwork — a
mis-tagged file could carry a real one. It returns the stream's absolute index
(not a boolean) because a file can hold both a real video stream and a cover, in
which case ffmpeg's `-map 0:v:0` would encode a frame of the movie as the
thumbnail. Audio without a cover is recorded as
`thumb_status = 'done'` with a NULL `thumb_path`: a normal state, not a failure.
That keeps the row out of `filesNeedingThumb()`, so it is not re-probed on every
scan. Embedding artwork later still gets picked up, because writing the tag
changes the file's size/mtime and `syncFiles()` resets such rows to `'pending'`;
a full index rebuild has the same effect.

`FileRow.hasThumb` (derived from `thumb_path IS NOT NULL`) is what the renderer
keys on, since `thumb_status` alone cannot distinguish a produced thumbnail from
a deliberate absence.

### Concurrency

`electron/core/concurrency.ts` provides `pool()`, a bounded parallel worker that
supports cancellation via `AbortSignal` while idle. `ScanManager` guards
against concurrent scans of the same workspace with its `scanning` set, which
avoids chunked-transaction conflicts.

Writes over every workspace outside a scan ("Apply to existing files" on the
auto-tagging screen) run through `WorkspacePasses`
(`electron/core/workspacePasses.ts`), one workspace at a time. Removing a
workspace goes through `holding()`, which aborts and waits for the pass on it
and keeps new ones off it until the removal is done; quitting calls
`abortAll()` next to `ScanManager.abortAll()`, so no pass writes into a
database after it is closed. A new pass of that kind belongs there too.

ffmpeg processes that decode video are capped process-wide by the
`videoDecodeSlots` semaphore in `electron/core/mediaConcurrency.ts`, shared between
the scan pipeline (video thumbnails) and the media server (frame grabs, image
transcodes, user-triggered thumbnail regeneration and frame export). Running
scans together hold at most all-but-one or -two of those slots so interactive
requests are never queued behind a thumbnail backlog. Scans run images and
videos in separate pools; only the expensive decodes inside (every video, and
images above `LARGE_IMAGE_PIXELS` or whose dimensions ffprobe could not
report) take a slot, so ffprobe and small-image thumbnails keep the full pool
width. Remux sessions (`-c copy`, no decode) have
a separate cap in `server.ts`.

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
