// Record the playlist showcase GIF (docs/assets/playlist.gif):
// starting the full-screen player from the list on screen, hands-off
// advancing through video and stills, shuffle, and stepping to the next item.
import path from "node:path";
import {
  assetsDir,
  hideToasts,
  launchApp,
  resolveMediaRoot,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

const chrome = () => page.locator("[data-slot='player-chrome']");

/** Nudge the pointer so the control bar (idle-hidden after 2.5s) comes back. */
async function wakeChrome() {
  await page.mouse.move(640, 700);
  await page.mouse.move(660, 690);
  await sleep(600);
}

try {
  await waitReady(page);

  // Images move fast enough here that a short GIF still shows two of them
  // hand off to each other; the app's own default is 5s.
  await page.evaluate(() => {
    const key = "meguri.prefs";
    const prefs = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...prefs, playlistImageSeconds: 4 }),
    );
  });
  await page.reload();
  await waitReady(page);
  await hideToasts(page);

  // A full-screen video stage changes every pixel every frame, so the GIF
  // needs a tighter budget than the other captures to stay README-sized.
  const rec = await startRecording(page, path.join(assetsDir, "playlist.gif"), {
    fps: 5,
    width: 720,
    colors: 64,
  });
  await sleep(1200);

  // The player takes the list exactly as it is on screen, so the GIF starts
  // on the library and follows the accent button in the corner.
  const start = page.getByRole("link", { name: "Play as playlist" });
  await start.hover();
  await sleep(700);
  await start.click();

  await chrome().waitFor({ timeout: 30_000 });
  await sleep(3500);

  // Skip ahead so the GIF does not sit through a whole clip.
  await wakeChrome();
  await page.getByRole("button", { name: "Next (N)" }).click();
  await sleep(3000);

  // Shuffle re-orders the rest of the pass without touching the saved order.
  await wakeChrome();
  await page.getByRole("button", { name: "Shuffle (S)" }).click();
  await sleep(1200);
  await page.getByRole("button", { name: "Next (N)" }).click();

  // Hands off: let the queue advance on its own through the next items,
  // including a still with its slow pan/zoom.
  await sleep(8000);

  await wakeChrome();
  await page.getByRole("button", { name: "Exit playback (Esc)" }).click();
  await sleep(1800);

  await rec.stop();
} finally {
  await close();
}
