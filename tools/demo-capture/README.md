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
node tools/demo-capture/shoot-gallery.mjs    # theme-*.png / view-*.png
node tools/demo-capture/shoot-history.mjs    # history.png — play-history view
```

To use your own media instead of the sample library:

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
xvfb-run -a -s "-screen 0 1400x1000x24" \
  env WAYLAND_DISPLAY= XDG_SESSION_TYPE=x11 ELECTRON_OZONE_PLATFORM_HINT=x11 \
  node tools/demo-capture/record-demo.mjs
```

## Notes

- Captures use a throwaway `--user-data-dir`, so your real app settings are
  untouched. Language is forced to English and the theme to the default so
  output is reproducible across machines.
- The scripts locate UI elements by English aria-labels and testids
  (`media-card`, `Discovery`, `Reshuffle`, …). If those change in the app,
  update the scenarios here.
- GIF encoding defaults (800px wide, 8 fps, 128 colors) live in
  `lib.mjs#startRecording` — tweak there if a capture comes out too large.
