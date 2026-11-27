# Media Pipeline

This document covers how files get into the database (the scan pipeline) and how
their bytes reach the renderer (the media server). Both depend on the bundled
ffmpeg/ffprobe binaries, whose path resolution is described at the end.

## Scan pipeline

`runScan()` in `electron/core/jobs.ts` drives the pipeline:
walk → `syncFiles` → thumbnail/metadata extraction (via a parallel pool),
reporting progress through a callback. `ScanManager` (`electron/scanManager.ts`)
owns the scan state and fires a scan with `start()` whenever a workspace is
added, switched to, or re-scanned; `app.ts` starts the initial scan and aborts
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
follows through the shared hash. A file whose content changes at the same path
keeps its metadata too: it is copied to the new hash (see
[`meta_key`](data-model.md#metadata-and-meta_key)).

A file that is gone from disk is only soft-deleted (`deleted_at`), so one that
comes back, at the same path or (by move detection) another, is revived with
its `files.id`, collections and thumbnail. Nothing removes these rows on its
own: whether a file is gone for good, or only in the trash or moved out for a
while, only the user knows. The "Missing files" screen (`/missing`, from the
scan menu) lists them, the most recently gone first and at most
`MAX_BULK_FILES` at a time, and removes the ones the user selects
(`purgeMissingFiles()` in `queries/missing.ts`): their rows, search entries,
thumbnails and collection entries. A removed file's id can be given to a new
file, which is why its collection entries go too. Metadata keyed by
`meta_key` stays. Files the user removed from the index (`excluded_at`) are
the exclusion list and are not listed, nor are files a scan exclusion hides
(see [Scan exclusions](#scan-exclusions)). A workspace being scanned is left out
of both the list and the removal: until the scan is through, files it has not
reached yet read as missing, and during a rebuild every file does.

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

### Scan exclusions

The user can keep folders and files out of scans (#282), in the
`scanExclusions` setting:

- `patterns`: for every workspace, each of a kind (#529), matched
  case-insensitively against the path relative to the workspace root, with
  `/` as the separator on every platform. A folder is matched with a
  trailing `/`. Each kind becomes a regular expression (`patternRegex()` in
  `shared/scanExclusions.ts`):
  - `name` (the default in Settings): a file or folder name at any depth,
    with `*` as the only wildcard (`private`, `*.tmp`); a folder covers what
    is in it. With a `/` before its end it is a path from the workspace root
    (`work/private`, `/private`); with a trailing `/` it takes folders only
    (`private/`). Only a name is trimmed.
  - `contains`: the text anywhere in the path.
  - `regex`: a regular expression, as written. A bare string stored before
    patterns had a kind is read as one.

  Edited in Settings → Scan, one field per pattern. A new pattern shows,
  before it is added, the listed files it would hide in every workspace
  (`scan_exclusions_preview`: a count and the first 50, read only). Main
  runs it in the auto-tag worker as a scan does, over each file and the
  folders above it (`coveredListedFiles()`); a newer preview stops the one
  running at its next chunk. A pattern whose preview did not finish cannot
  be added: the worker leaves it out for the session, and every scan would
  fail with it saved. Common patterns fill the field in one click.

- `folders`: per workspace ID, root-relative folders, each covering
  everything below it. Added from a folder card's context menu in the folder
  view ("Exclude from scans"), which hides its files at once after a
  confirmation that shows the folder on disk and how many files it hides.
  Listed in the workspace's edit dialog by where they are on disk (a bare
  relative path would read like every folder of that name), marked "Not
  found" when the folder is no longer on disk (renamed or gone). The dialog
  can also add one through the OS folder picker (`scan_exclusions_pick_folder`,
  which only picks, and refuses a folder outside the workspace). Taking a
  folder off and adding one are both staged: the row stays, marked, until the
  dialog is saved, and can be undone until then. Saving sends them together
  (`scan_exclusions_update_folders`), so they all go or none do. Settings →
  Scan counts each workspace's folders and opens its edit dialog.

The patterns are user regexes, so they never run on the main thread: they go
to the auto-tag worker as auto-tagging rules (`exclusionRule()` in
`shared/scanExclusions.ts`), which brings its time budget and its leaving out
of a pattern that never finishes. The engine matches a name without its
extension, so each path is sent with a suffix it takes off
(`exclusionSubject()`), and it skips empty matches, so each pattern is wrapped
to match the path's first character wherever it matches (a pattern of
lookaheads alone still excludes). The patterns are sent as a `whole` engine:
when the worker cannot run, or has left a pattern out because it did not
finish (for the rest of the session), the scan fails before the index is
touched rather than letting in what the pattern covers, and the user is told
to change the pattern. `electron/core/scanExclusionFilter.ts` builds the
filter for one workspace.

- **The walk** asks the filter once per level of the tree, for everything
  found there. An excluded folder is not read, so nothing under it is hashed,
  indexed or reported as unreadable.
- **Indexed files a rule covers** are hidden, not deleted (`hideFiles()`):
  `deleted_at` keeps them out of every list, and `scan_excluded_at` keeps
  them out of Missing and of the move detection. The row and its `files.id`
  (which collections and Watch Later refer to) stay. This runs when the
  patterns are saved (in every workspace, without reading the disk, through
  `WorkspacePasses`), after a scan's walk, and once more as the scan ends,
  for a rule saved while it ran. The rows are written a chunk at a time,
  yielding in between. A save is reported as saved once it is written, even
  when hiding fails: the next scan applies it.
- **A rule taken out** lets its files go at the next scan: its sync treats
  them as any other row, bringing back each file still there (also when it
  was moved) with its id and clearing the mark. Once the scan is through,
  the mark is cleared on the rest, which are then missing like any file that
  is gone. A scan cut short leaves them hidden, not missing. The mark is not
  cleared when the rule goes, since the files would read as missing until a
  scan found them.
- **A rebuild** keeps the hidden rows as they are, with their thumbnails,
  except those no rule covers any more, which it resets like any other row.
  Resync clears only the files removed from the index by hand.
- Excluded folders follow paths: when one is renamed, its files are scanned
  again under the new path as new rows, and the old rows stay hidden.

### Metadata and thumbnails

`electron/core/media.ts` extracts metadata with ffprobe and generates thumbnails
with ffmpeg, written as WebP.

ffprobe reads no EXIF from a still image, so for a photo `extractMeta()` also
reads its EXIF with ExifReader (`electron/core/exif.ts`), alongside ffprobe and
independent of it: a picture ffprobe cannot read can still say when it was
taken. ExifReader reads only the bytes that hold the metadata
(`length: "auto"`), and the XMP parser is passed in (`@xmldom/xmldom`) rather
than left to ExifReader's own lookup. The capture time is `DateTimeOriginal`,
then `DateTimeDigitized`, then the same dates in XMP; EXIF wins because cameras
write it. The matching offset tag (`OffsetTimeOriginal`, …) places the time;
without one it is read as the computer's local time, which is what the camera's
clock showed and the day the timeline buckets by. A file that cannot be opened
leaves `exif` NULL for a later scan; one that opens but has no EXIF stores
`'{}'` (see [Data Model](data-model.md#schema)).

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

where `kind` is `thumb`, `media`, `frame` or `waveform`. The server resolves the workspace
by ID (not the active selection), so playback is independent of which workspace
is currently focused.

### Thumbnails

Thumbnails are served with `Cache-Control: no-cache` and an ETag from the
file's size and modification time, so the browser asks again on every load and
an unchanged thumbnail comes back as a 304. Each view puts its own `?v=` count
in the URL, so one view can ask for a regenerated thumbnail under a URL another
view cached before; revalidating keeps it from showing the old picture.

### Range streaming

Directly playable files use HTTP Range requests for full seeking. The server
serves MP4, M4V, and MOV this way when the player decodes their video and
default audio. Other video codecs, and MP4, M4V, or MOV whose default audio it
cannot decode, use the streaming paths below.

### On-the-fly remux

Containers Chromium cannot demux — `REMUX_CONTAINERS` = `mkv` / `avi` / `wmv` /
`flv` / `ts` — are remuxed to fragmented MP4 on the fly
(`-movflags frag_keyframe+empty_moov+default_base_moof`). Time seeking uses a
`?t=<seconds>` query parameter.

Which codecs need converting is listed in [Playback support](#playback-support).
A video codec the player cannot decode gets a local H.264 preview in whatever
container it is in, and audio it cannot decode is converted to AAC, keeping its
channel count. A remux converts the audio when any track needs it, and an MP4,
M4V, or MOV played directly is remuxed when its default audio does; both copy
the picture stream. A copy FFmpeg gives up on before writing anything, such as
VP8 in MKV, which the MP4 muxer refuses, is tried once more as a preview.

If a video loads but the player decodes no picture although the scan measured
one (HEVC on Linux), the player shows that the picture could not be decoded
instead of playing sound over a black frame.

A preview of a clip tagged as PQ or HLG HDR is tone mapped to Rec.709 with
zscale and tonemap (`electron/core/videoPreview.ts`), when the bundled ffmpeg
has both filters; the server checks that once, with `ffmpeg -filters`, and
retries after a failed check.

A preview is encoded with libx264. An ffmpeg built without it (libx264 is GPL,
so an LGPL build lacks it) encodes with `h264_videotoolbox` on macOS instead.
The server picks the encoder once, with `ffmpeg -encoders`, for every preview
including a copy retried as one, and asks again after a failed check.

Chromium-unsupported still images (`heic` /
`heif` / `tiff`, `TRANSCODE_IMAGES`) are transcoded to JPEG.

### Playback support

How the media server serves each container and codec to the built-in player.
"Checked" means a clip played with picture and sound in the built app on Linux
(#294); the other rows follow from the same rule. The video rule is
`needsVideoPreview` in `shared/playbackTracks.ts` and the audio rule is
`needsAacAudio` in `electron/core/playbackAudio.ts`. When either changes, update
these tables, and `e2e/playback-codecs.spec.ts` for a codec worth keeping under
test.

| Container              | Served as                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MP4, M4V, MOV          | The file itself, with Range, when the player decodes its video and default audio; otherwise remuxed or previewed |
| WebM                   | The file itself, with Range                                                                                      |
| MKV, AVI, WMV, FLV, TS | Remuxed to fragmented MP4, or previewed                                                                          |

| Video codec                                                           | Handling                                                               | Checked              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| H.264 (8-bit, 10-bit, 4:2:2)                                          | Copied                                                                 | Yes                  |
| VP9, AV1                                                              | Copied                                                                 | Yes                  |
| VP8                                                                   | Copied in WebM; a preview in other containers, after the copy fails    | Yes                  |
| HEVC                                                                  | Copied; plays only where the platform decodes it, which Linux does not | Yes (error on Linux) |
| ProRes                                                                | H.264 preview, PQ and HLG tone mapped                                  | Yes                  |
| MPEG-4 Part 2, Motion JPEG, WMV, MPEG-2, Sorenson Spark (FLV), Theora | H.264 preview                                                          | Yes                  |
| Any other codec                                                       | H.264 preview                                                          | No                   |

| Audio codec                                               | Handling | Checked |
| --------------------------------------------------------- | -------- | ------- |
| AAC, MP3, Opus, Vorbis, FLAC                              | Copied   | Yes     |
| PCM: 16-bit (little and big endian), 24-bit, 32-bit float | Copied   | Yes     |
| AC-3, E-AC-3, DTS, TrueHD, ALAC, MP2                      | AAC      | Yes     |
| PCM: 8-bit, A-law, µ-law (the MP4 muxer refuses them)     | AAC      | Yes     |
| Any other codec                                           | AAC      | No      |

A previewed video always gets AAC audio.

The codec and tracks come from the metadata the scan stored. For a video the
scan has not reached yet, or one ffprobe cannot read, the server probes it
itself (`probePlaybackMetadata` in `electron/core/playbackMetadata.ts`) and
remembers the result, a failure included, by path, size and modification time.
The range requests and seeks of one playback then reuse it instead of running
ffprobe each time. A probe that hits its five-second limit is not remembered.

### Frame previews

A `frame` request returns a single JPEG frame at `?t=<seconds>`, used for seek
previews.

### Waveforms

A `waveform` request returns a PNG of an audio file's whole waveform (2000×120,
white on transparent, square-root scale, peak samples), used by the filmstrip
view, which draws it as a mask in a theme color. Other kinds get 404. It
decodes the whole file in one decode slot (about a second for an hour of AAC);
a file that takes longer than the request timeout gets no image.

### Authorization

Requests must carry an `X-Api-Token` header. The Electron session injects it for
in-app media loads, so renderer code does not handle it directly. Main-process
code that fetches from the server itself (an app's `setup`, for example) gets
the token from `IpcContext.mediaToken()` and sends it with each request; the
token never reaches the renderer or the preload.

### ffmpeg/ffprobe path resolution

The bundled ffmpeg/ffprobe binaries are unpacked from the asar archive at
runtime: `electron/core/ffmpeg-paths.ts` rewrites `app.asar` to
`app.asar.unpacked` in the binary paths. This is the only place that rewrite
should happen. The corresponding electron-builder `asarUnpack` configuration is
covered in [Build and CI](build-and-ci.md#packaging).

When the `MEGURI_FFMPEG_DIR` environment variable is set, the same module runs
`ffmpeg` and `ffprobe` from that directory instead (for example `/usr/bin`). A
distribution package that depends on the system FFmpeg sets it in its launcher
(see [Build and CI](build-and-ci.md#ci)). The switch is explicit, not a
fallback when the bundled file is missing: a build that lost its bundled FFmpeg
by mistake still fails with the one-time "ffprobe could not be started"
warning in `main.log`, and ffmpeg and ffprobe always come from one place.
