// Shared helpers for the README demo capture scripts.
// See tools/demo-capture/README.md for usage.
/* global document, window -- used inside page.evaluate(), which runs in the app */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronLaunchOptions, mainScript } from "../../scripts/electron-launch.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../..");
export const assetsDir = path.join(repoRoot, "docs/assets");
export const defaultMediaDir = path.join(__dirname, ".media");

const require = createRequire(path.join(repoRoot, "package.json"));
const { _electron } = require("@playwright/test");
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
  if (!fs.existsSync(mainScript)) {
    throw new Error("Built main script not found. Run `npm run build` first.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-capture-"));
  // No startup update check: its toast would land in any capture that shows
  // toasts, and a capture should not depend on the network. The shape is
  // UpdateConfig in electron/core/appConfig.ts; every other field defaults.
  fs.writeFileSync(
    path.join(userDataDir, "config.json"),
    JSON.stringify({ update: { autoCheck: false } }),
  );
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${userDataDir}`, "--force-device-scale-factor=1"],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: mediaRoot },
    }),
  );

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

const HIDE_TOASTS_CSS =
  'section[aria-label^="Notifications"] { display: none !important; }';

/**
 * Hide the toast layer (scan-done / update notifications) so it neither
 * shows up in captures nor intercepts pointer events.
 */
export async function hideToasts(page) {
  await page.addStyleTag({ content: HIDE_TOASTS_CSS });
}

/**
 * Bring the toast layer back, for captures where a toast is part of the story.
 * waitReady() hides it again, so call this after the last helper that waits
 * (seedTags, setTheme).
 */
export async function showToasts(page) {
  await page.evaluate((css) => {
    for (const style of document.querySelectorAll("style")) {
      if (style.textContent === css) style.remove();
    }
  }, HIDE_TOASTS_CSS);
}

// Manual tags for the sample library, by file name. Several are shared across
// folders (sea, sunset, …) so the graph view has hubs to draw and the cards
// have chips to show. Files not listed here (your own media) get none. The
// names are the ones fetch-media.mjs writes; keep the two in step.
const SAMPLE_TAGS = {
  "bbb-10s.mp4": ["animation", "blender", "landscape"],
  "jellyfish-10s.mp4": ["sea", "wildlife"],
  "sintel-10s.mp4": ["animation", "blender", "fantasy"],
  "sintel-trailer.mp4": ["animation", "blender", "fantasy"],
  "tears-of-steel-60s.mp4": ["blender", "sci-fi"],
  "photo-1.jpg": ["landscape", "wildlife"],
  "photo-2.jpg": ["architecture"],
  "photo-3.jpg": ["landscape"],
  "photo-4.jpg": ["portrait"],
  "photo-5.jpg": ["monochrome", "wildlife"],
  "photo-6.jpg": ["sea", "architecture"],
  "photo-7.jpg": ["landscape", "sunset"],
  "photo-8.jpg": ["architecture", "sunset"],
  "photo-9.jpg": ["still-life"],
  "photo-10.jpg": ["sea", "landscape"],
  "photo-11.jpg": ["sea", "architecture", "sunset"],
  "photo-12.jpg": ["architecture", "monochrome"],
  "Morning Coast.mp3": ["ambient", "sea"],
  "Night Drive.mp3": ["ambient", "sci-fi"],
  "Quiet Garden.mp3": ["ambient", "landscape"],
  "Field Notes.mp3": ["ambient"],
  "Open Sky.mp3": ["ambient"],
};

/**
 * Tag the sample library through the app's own IPC, then reload so the list
 * shows the chips. Call after waitReady(); leaves the page ready again. The
 * reload also applies anything the caller put in localStorage beforehand.
 */
export async function seedTags(page) {
  const tagged = await page.evaluate(async (tagsByName) => {
    // One page of results, which covers the sample library many times over.
    const { items } = await window.api.invoke("files_search", { query: {} });
    let n = 0;
    for (const { id, workspaceId, relPath } of items) {
      const names = tagsByName[relPath.split("/").pop()];
      if (!names) continue;
      n += 1;
      for (const name of names) {
        await window.api.invoke("file_add_tag", { id, workspaceId, name });
      }
    }
    return n;
  }, SAMPLE_TAGS);
  if (tagged === 0) {
    console.warn(
      "seedTags: no sample file found, so nothing was tagged " +
        "(run fetch-media.mjs, or check SAMPLE_TAGS against it).",
    );
  }
  await page.reload();
  await waitReady(page);
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
