# demo-capture

Scripts that (re)generate the README demo GIFs and gallery screenshots in
`docs/assets/`. They drive the built app with Playwright, capture frames via
CDP screencast, and encode with the bundled ffmpeg-static — no system ffmpeg
or extra npm install required.

## Prerequisites

- `npm install` and `npm run build` (the scripts launch `out/main/main.js`)
- Linux only: `xvfb-run` is recommended (see below)

## Usage

```bash
# 1. Fetch a small copyright-free sample library (Lorem Picsum + Blender
#    open movies). Skip this if you want to shoot your own media instead.
node tools/demo-capture/fetch-media.mjs

# 2. Capture (each writes straight into docs/assets/)
node tools/demo-capture/record-demo.mjs      # demo.gif — overview tour
node tools/demo-capture/record-discover.mjs  # discover.gif — Discovery showcase
node tools/demo-capture/record-playlist.mjs  # playlist.gif — playlist player
node tools/demo-capture/record-graph.mjs     # graph.gif, graph-2d.png / graph-3d.png — graph view
node tools/demo-capture/record-folders.mjs   # folders.gif, view-folders.png — folder view
node tools/demo-capture/record-bulk-edit.mjs # bulk-edit.gif, bulk-edit.png — multi-select and bulk edit
node tools/demo-capture/record-pet.mjs       # pet.gif — the pet
node tools/demo-capture/shoot-gallery.mjs    # theme-*.png / view-list.png
node tools/demo-capture/shoot-history.mjs    # history.png — play-history view
node tools/demo-capture/shoot-peek.mjs       # side-peek.png — side peek
node tools/demo-capture/shoot-audio.mjs      # audio.png — player bar
node tools/demo-capture/shoot-spectrum.mjs   # spectrum*.png — audio spectrum
```

`record-graph.mjs`, `record-folders.mjs`, `record-bulk-edit.mjs` and
`record-pet.mjs` tag the sample library first (`lib.mjs#seedTags`, by file
name), so the cards carry tag chips and the graph has hubs to draw. The first
three also cut their stills from the same run, at the frame worth keeping.

To use your own media instead of the sample library (not for the graph,
folder and bulk-edit captures, which act on the sample's folders, file names
and tags):

```bash
MEGURI_DEMO_MEDIA=/path/to/media node tools/demo-capture/record-demo.mjs
```

Note that the media directory path is visible in the app header, so pick a
path you are happy to publish (the sample fetcher's default is
`tools/demo-capture/.media`, which shows your local repo path — pass a neutral
directory like `/tmp/Videos` to `fetch-media.mjs` if you prefer).

## Linux: run under Xvfb

Tiling window managers resize the app window and fractional display scaling
skews the capture resolution. Running under a virtual framebuffer avoids both:

```bash
MEGURI_FORCE_X11=1 xvfb-run -a -s "-screen 0 1400x1000x24" \
  node tools/demo-capture/record-demo.mjs
```

`MEGURI_FORCE_X11=1` makes the shared launch helper
(`scripts/electron-launch.cjs`) pin Electron to X11; without it, a Wayland
session would bypass Xvfb.

`fetch-media.mjs` also synthesises a few audio tracks (tones and noise,
with a photo embedded as cover art) into `Music/`; `--audio-only` rewrites
just those.

`shoot-peek.mjs`, `shoot-audio.mjs` and `shoot-spectrum.mjs` need a real
display: under Xvfb the built-in player fails to decode the sample videos,
so the sheet would show the fallback notice instead of a playing frame, and
no audio plays, so the spectrum would have nothing to draw. On a tiling compositor the
window has to be floated so it keeps the requested 1280×800; on Hyprland,
`hypr-float.sh` waits for the app window, floats it and sizes it — run it in
the background right before the script:

```bash
tools/demo-capture/hypr-float.sh & node tools/demo-capture/shoot-peek.mjs
```

## Notes

- Captures use a throwaway `--user-data-dir`, so your real app settings are
  untouched. The startup update check is switched off there, so no capture
  depends on the network or picks up its toast. Language is forced to English and the theme to the default so
  output is reproducible across machines.
- The scripts locate UI elements by English aria-labels and testids
  (`media-card`, `Discovery`, `Reshuffle`, `Play as playlist`, …). If those
  change in the app, update the scenarios here.
- GIF encoding defaults (800px wide, 8 fps, 128 colors) live in
  `lib.mjs#startRecording` — tweak there if a capture comes out too large.
