// Record the Discovery showcase GIF (docs/assets/discover.gif):
// the immersive view, scene-rail hover previews, carousel navigation,
// and reshuffle.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

// Scene-rail tiles only render on the active slide, so this matches the
// current pick's rail (links carry a `t=` seek param).
const railTiles = () => page.getByRole("dialog").locator("a[href*='?t=']");

// Step through picks until a video (with a scene rail) is active.
async function nextVideoPick(maxSteps = 8) {
  for (let i = 0; i < maxSteps; i += 1) {
    if ((await railTiles().count()) > 0) return true;
    await page.keyboard.press("ArrowRight");
    await sleep(1100);
  }
  return (await railTiles().count()) > 0;
}

// Glide along the first few rail tiles so the hover-enlarge shows.
async function hoverRail() {
  const tiles = railTiles();
  const n = Math.min(await tiles.count(), 3);
  for (let i = 0; i < n; i += 1) {
    await tiles.nth(i).hover({ timeout: 2000 }).catch(() => {});
    await sleep(750);
  }
  await page.mouse.move(640, 60);
  await sleep(400);
}

try {
  await waitReady(page);

  // open Discovery before recording so the GIF stars the modal itself
  await page.getByRole("link", { name: "Discovery" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Discovery", { exact: true })
    .waitFor({ timeout: 30_000 });
  await sleep(1000);

  // the immersive view animates edge-to-edge, so keep fps/colors modest to
  // hold the GIF to a README-friendly size
  const rec = await startRecording(page, path.join(assetsDir, "discover.gif"), {
    fps: 6,
    colors: 96,
  });
  await sleep(1500);

  await nextVideoPick();
  await hoverRail();

  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press("ArrowRight");
    await sleep(1300);
  }

  await page.getByRole("button", { name: "Reshuffle" }).click();
  await sleep(2000);

  if (await nextVideoPick()) {
    await hoverRail();
    // "Play" is a Link in the immersive card (both the full-card overlay and
    // the labeled action button carry the name); either one starts playback.
    const playBtn = dialog
      .getByRole("link", { name: "Play", exact: true })
      .last();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
      await sleep(3500);
    }
  } else {
    await page.keyboard.press("ArrowRight");
    await sleep(1500);
  }

  await rec.stop();
} finally {
  await close();
}
