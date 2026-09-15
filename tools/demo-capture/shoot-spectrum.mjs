// Capture the audio spectrum screenshots: spectrum.png — the detail view of
// a cover-less track with the default pattern filling the stage — and
// spectrum-patterns.png — a contact sheet of every pattern, one stage
// each, stepped through with the V key. Needs the synthesised tracks from
// fetch-media.mjs and, like shoot-peek.mjs, a real display.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  assetsDir,
  launchApp,
  repoRoot,
  resolveMediaRoot,
  screenshotTo,
  sleep,
  waitReady,
} from "./lib.mjs";

const require = createRequire(path.join(repoRoot, "package.json"));
const ffmpegPath = require("ffmpeg-static");

// Settings order (src/audio/spectrumPatterns.ts) with the Settings labels.
const PATTERNS = [
  ["bars", "Bars"],
  ["ring", "Ring"],
  ["led", "LED meter"],
  ["mirror", "Mirrored bars"],
  ["wave", "Oscilloscope"],
  ["area", "Filled area"],
  ["particles", "Particles"],
  ["strings", "Strings"],
  ["ridge", "Ridgeline"],
  ["ripple", "Ripples"],
  ["orbs", "Orbs"],
  ["barcode", "Barcode"],
];
const COLS = 4;
const TILE_WIDTH = 480;

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });
const tilesDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-spectrum-"));

try {
  await waitReady(page);

  // The track without cover art, so the pattern is the whole stage. Its
  // thumbnail link has no accessible name (a glyph, no <img alt>), so it is
  // found through the card rather than by role.
  const track = page
    .getByTestId("media-card")
    .filter({ hasText: "Open Sky.mp3" })
    .locator("a[data-thumb]");
  await track.scrollIntoViewIfNeeded();
  await sleep(500);
  await track.click();
  await page
    .getByRole("region", { name: "Audio player" })
    .waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Open details:/ }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30_000 });

  // The throwaway profile starts on the default pattern, the first in the
  // list; the loop below steps from there.
  const spectrum = page.locator(
    `[data-testid="audio-spectrum"][data-pattern="${PATTERNS[0][0]}"]`,
  );
  await spectrum.waitFor();
  // Off the stage, so neither the play glyph nor the transport shows.
  await page.mouse.move(2, 2);
  await sleep(3000); // let the levels settle and the seek bar move

  await screenshotTo(page, path.join(assetsDir, "spectrum.png"));

  // One stage per pattern, labelled in the corner, stepped with V. The
  // testid is on the canvas; its wrapper is the pattern's box (the whole
  // stage only for a cover-less track), and the stage is the wrapper's parent.
  const stage = page.getByTestId("audio-spectrum").locator("xpath=../..");
  for (let i = 0; i < PATTERNS.length; i += 1) {
    const [id, label] = PATTERNS[i];
    if (i > 0) {
      await page.keyboard.press("v");
      await page
        .locator(`[data-testid="audio-spectrum"][data-pattern="${id}"]`)
        .waitFor();
    }
    await sleep(2500);
    await stage.evaluate((el, text) => {
      el.querySelector(".capture-label")?.remove();
      const tag = document.createElement("div");
      tag.className = "capture-label";
      tag.textContent = text;
      Object.assign(tag.style, {
        position: "absolute",
        right: "16px",
        top: "14px",
        padding: "8px 18px",
        borderRadius: "999px",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        // Large: the tile is scaled to about a third for the sheet.
        font: "600 34px system-ui, sans-serif",
        letterSpacing: "0.01em",
        pointerEvents: "none",
      });
      el.appendChild(tag);
    }, label);
    await stage.screenshot({ path: path.join(tilesDir, `${id}.png`) });
    console.log(`captured ${id}`);
  }
  await stage.evaluate((el) => el.querySelector(".capture-label")?.remove());

  // Contact sheet: COLS across, tiles scaled to TILE_WIDTH, thin gutters.
  const rows = Math.ceil(PATTERNS.length / COLS);
  const inputs = PATTERNS.flatMap(([id]) => [
    "-i",
    path.join(tilesDir, `${id}.png`),
  ]);
  const scaled = PATTERNS.map(
    (_, i) =>
      `[${i}:v]scale=${TILE_WIDTH}:-1:flags=lanczos,pad=iw+8:ih+8:4:4:black[t${i}]`,
  ).join(";");
  // Each tile sits after the tiles to its left in its row, and below the
  // tiles above it in its column.
  const layout = PATTERNS.map((_, i) => {
    const x = i % COLS;
    const y = Math.floor(i / COLS);
    const xs =
      x === 0
        ? "0"
        : Array.from({ length: x }, (_, k) => `w${y * COLS + k}`).join("+");
    const ys =
      y === 0
        ? "0"
        : Array.from({ length: y }, (_, k) => `h${k * COLS + x}`).join("+");
    return `${xs}_${ys}`;
  }).join("|");
  const stack = `${PATTERNS.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${PATTERNS.length}:layout=${layout}[v]`;
  const out = path.join(assetsDir, "spectrum-patterns.png");
  execFileSync(ffmpegPath, [
    "-y",
    ...inputs,
    "-filter_complex",
    `${scaled};${stack}`,
    "-map",
    "[v]",
    "-update",
    "1",
    "-frames:v",
    "1",
    out,
  ]);
  console.log(`wrote ${out} (${rows} rows)`);
} finally {
  fs.rmSync(tilesDir, { recursive: true, force: true });
  await close();
}
