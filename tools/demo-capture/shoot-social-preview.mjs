// Capture the repository's social preview image (docs/assets/social-preview.png,
// 1280×640): the landing page's wallpaper (docs/index.html), the logo and the
// tagline on the left, and the app on the right as a window. The app is shot
// first, then the card is laid out in a second, hidden window of the same
// Electron and captured from there, so no browser is needed.
//
// GitHub keeps its own copy: upload the new file under the repository's
// Settings > General > Social preview.
import fs from "node:fs";
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  setTheme,
  waitReady,
} from "./lib.mjs";

const WIDTH = 1280;
const HEIGHT = 640;
const out = path.join(assetsDir, "social-preview.png");
const dataUrl = (file, type) =>
  `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;

const { app, page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

try {
  await waitReady(page);
  await setTheme(page, "solarized-light");
  const shot = await page.screenshot();

  const icon = dataUrl(path.join(assetsDir, "icon.png"), "image/png");
  const screen = `data:image/png;base64,${shot.toString("base64")}`;
  const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fff8ec;
    /* The landing page's wallpaper (docs/index.html, .desktop). */
    background: linear-gradient(135deg, #f0cf9a 0%, #dc9a6e 38%, #9a7d94 72%, #4f5f88 100%);
  }
  .text { position: absolute; left: 72px; top: 132px; width: 520px;
    text-shadow: 0 2px 12px rgba(60, 30, 20, .25); }
  .brand { display: flex; align-items: center; gap: 24px; }
  .brand img { width: 108px; height: 108px; border-radius: 24%;
    box-shadow: 0 10px 28px rgba(60, 25, 15, .35); }
  h1 { font-size: 84px; font-weight: 800; letter-spacing: -1px; }
  .tagline { margin-top: 44px; font-size: 32px; font-weight: 700; line-height: 1.3; }
  .sub { margin-top: 18px; font-size: 22px; line-height: 1.45; opacity: .9; }
  .os { margin-top: 30px; display: flex; gap: 12px; }
  .os span { padding: 6px 16px; border-radius: 999px; font-size: 18px; font-weight: 600;
    background: rgba(255, 248, 236, .18); border: 1px solid rgba(255, 248, 236, .45); }
  /* The app as a window, cut off by the right edge. */
  .win { position: absolute; left: 640px; top: 76px; width: 760px;
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 18px 44px rgba(20, 14, 8, .45), 0 4px 12px rgba(20, 14, 8, .3); }
  .win img { display: block; width: 100%; }
  </style>
  <div class="text">
    <div class="brand"><img src="${icon}" alt=""><h1>Meguri</h1></div>
    <p class="tagline">A local-first library for your videos, photos &amp; audio</p>
    <p class="sub">Scan, browse, search, and play — all offline.<br>No cloud, no account.</p>
    <div class="os"><span>Linux</span><span>Windows</span><span>macOS</span></div>
  </div>
  <div class="win"><img src="${screen}" alt=""></div>`;

  // A window of its own, made by main and loaded by main, so the app's
  // navigation guards (renderer-initiated navigations only) do not apply.
  const png = await app.evaluate(
    async ({ BrowserWindow }, { html, width, height }) => {
      const win = new BrowserWindow({
        width,
        height,
        show: false,
        useContentSize: true,
        paintWhenInitiallyHidden: true,
        webPreferences: { javascript: false },
      });
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );
      await new Promise((r) => setTimeout(r, 500));
      const image = await win.capturePage({ x: 0, y: 0, width, height });
      win.destroy();
      return image.toPNG().toString("base64");
    },
    { html, width: WIDTH, height: HEIGHT },
  );
  fs.writeFileSync(out, Buffer.from(png, "base64"));
  console.log(`wrote ${out}`);
} finally {
  await close();
}
