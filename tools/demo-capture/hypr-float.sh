#!/usr/bin/env bash
# Hyprland helper for the captures that need a real display: waits for the
# app window (class "electron", title "Meguri — …") to be mapped, floats it
# and sizes it to the capture resolution, so the tiling layout does not
# squeeze it into whatever slot is free. Run it in the background right
# before a shoot-*.mjs script, e.g.:
#
#   tools/demo-capture/hypr-float.sh & node tools/demo-capture/shoot-peek.mjs
#
# Uses the Lua dispatcher API (Hyprland 0.56+).
set -euo pipefail

width=${1:-1280}
height=${2:-800}

# Prints "<address> <w> <h>" for the mapped app window, or nothing.
find_window() {
  hyprctl clients -j | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const c = JSON.parse(s).find(
        (w) => w.mapped && w.class === "electron" && /^Meguri/.test(w.title),
      );
      if (c) console.log(c.address, c.size[0], c.size[1]);
    });
  '
}

# The window only takes its tiled size once mapped; floating it earlier is
# undone by that. So wait for it to be mapped, then float, size and re-check.
for _ in $(seq 1 120); do
  read -r addr w h < <(find_window) || true
  if [ -n "${addr:-}" ]; then
    if [ "$w" = "$width" ] && [ "$h" = "$height" ]; then
      exit 0
    fi
    win="\"address:$addr\""
    hyprctl dispatch "hl.dsp.window.float({ action = 'on', window = $win })" >/dev/null
    hyprctl dispatch "hl.dsp.window.resize({ x = $width, y = $height, relative = false, window = $win })" >/dev/null
    hyprctl dispatch "hl.dsp.window.center({ window = $win })" >/dev/null
  fi
  sleep 0.5
done
echo "hypr-float: app window not found or not resized" >&2
exit 1
