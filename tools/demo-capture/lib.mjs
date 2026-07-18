// Shared helpers for the README demo capture scripts.
// See tools/demo-capture/README.md for usage.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../..");
export const assetsDir = path.join(repoRoot, "docs/assets");
export const defaultMediaDir = path.join(__dirname, ".media");

const require = createRequire(path.join(repoRoot, "package.json"));
const { _electron } = require("@playwright/test");
const electronExecutable = require("electron");
const ffmpegPath = require("ffmpeg-static");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Media directory to scan: MEGURI_DEMO_MEDIA, or the fetch-media.mjs output. */
export function resolveMediaRoot() {
  const root = process.env.MEGURI_DEMO_MEDIA || defaultMediaDir;
  if (!fs.existsSync(root) || fs.readdirSync(root).length === 0) {
    throw new Error(
      `Media directory not found or empty: ${root}\n` +
        "Run `node tools/demo-capture/fetch-media.mjs` first, or point " +
        "MEGURI_DEMO_MEDIA at a directory of your own videos/images.",
    );
  }
  return root;
}

/**
 * Launch the built app against a throwaway user-data dir.
 * Returns { app, page, close }; always await close() when done.
 */
export async function launchApp({ mediaRoot, width = 1280, height = 800 }) {
  const mainScript = path.join(repoRoot, "out/main/main.js");
  if (!fs.existsSync(mainScript)) {
    throw new Error("Built main script not found. Run `npm run build` first.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-capture-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    executablePath: electronExecutable,
    args: [
      mainScript,
      `--user-data-dir=${userDataDir}`,
      "--force-device-scale-factor=1",
    ],
    env: { ...env, MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: mediaRoot },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
  }, { width, height });

  // Selectors in the capture scripts assume the English locale, and the
  // screenshots should not depend on the host machine's saved preferences.
  await page.evaluate(() => {
    localStorage.setItem("meguri.lang", "en");
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  const close = async () => {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  return { app, page, close };
}

/** Wait until the initial scan and thumbnail generation are done. */
export async function waitReady(page) {
  await page.getByTestId("media-card").first().waitFor({ timeout: 60_000 });
  await page
    .getByRole("contentinfo", { name: "Status bar" })
    .filter({ hasText: "Idle" })
    .waitFor({ timeout: 120_000 });
  await hideToasts(page);
  await sleep(1500);
}

/**
 * Hide the toast layer (scan-done / update notifications) so it neither
 * shows up in captures nor intercepts pointer events.
 */
export async function hideToasts(page) {
  await page.addStyleTag({
    content: 'section[aria-label^="Notifications"] { display: none !important; }',
  });
}

/** Switch the base16 theme (persisted the same way the ThemeProvider does). */
export async function setTheme(page, themeId) {
  await page.evaluate((t) => localStorage.setItem("meguri.theme", t), themeId);
  await page.reload();
  await waitReady(page);
}

/**
 * Record the page via CDP screencast. Returns { stop } where stop() ends the
 * capture and encodes the frames into an optimized GIF at outGif.
 */
export async function startRecording(page, outGif, { fps = 8, width = 800, colors = 128 } = {}) {
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-frames-"));
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let frameNo = 0;
  cdp.on("Page.screencastFrame", async (ev) => {
    const file = path.join(framesDir, `f${String(frameNo).padStart(5, "0")}.jpg`);
    frameNo += 1;
    fs.writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, ts: ev.metadata.timestamp });
    await cdp
      .send("Page.screencastFrameAck", { sessionId: ev.sessionId })
      .catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    everyNthFrame: 2,
  });

  const stop = async () => {
    await cdp.send("Page.stopScreencast");
    await sleep(300);
    if (frames.length === 0) throw new Error("No frames captured.");

    // concat file with real per-frame durations (screencast only emits on change)
    const lines = [];
    for (let i = 0; i < frames.length; i += 1) {
      const dur = i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 0.1;
      lines.push(`file '${frames[i].file}'`);
      lines.push(`duration ${Math.max(dur, 0.01).toFixed(4)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    const concatFile = path.join(framesDir, "frames.txt");
    fs.writeFileSync(concatFile, lines.join("\n"));

    fs.mkdirSync(path.dirname(outGif), { recursive: true });
    execFileSync(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-vf",
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=max_colors=${colors}[p];` +
        "[s1][p]paletteuse=dither=bayer:bayer_scale=5",
      "-loop", "0",
      outGif,
    ]);
    fs.rmSync(framesDir, { recursive: true, force: true });
    console.log(`wrote ${outGif} (${frames.length} frames captured)`);
  };
  return { stop };
}

/** Screenshot the window and save a width-limited PNG at outPng. */
export async function screenshotTo(page, outPng, { width = 800 } = {}) {
  const tmp = path.join(os.tmpdir(), `meguri-shot-${path.basename(outPng)}`);
  await page.screenshot({ path: tmp });
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  execFileSync(ffmpegPath, [
    "-y",
    "-i", tmp,
    "-vf", `scale=${width}:-1:flags=lanczos`,
    "-update", "1",
    "-frames:v", "1",
    outPng,
  ]);
  fs.rmSync(tmp, { force: true });
  console.log(`wrote ${outPng}`);
}
