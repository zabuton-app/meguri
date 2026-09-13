// Capture the side-peek screenshot (docs/assets/side-peek.png): the detail
// view docked beside the library, with the list still in use next to it.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  sleep,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

try {
  await waitReady(page);

  // Open as a side peek at a width that leaves a good share of the grid.
  await page.evaluate(() => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    localStorage.setItem("meguri.media.detail.peekWidth", "480");
  });
  await page.reload();
  await waitReady(page);

  // A sample the built-in player plays under the virtual framebuffer (the
  // jellyfish clip falls back to the external-player notice there), so the
  // sheet shows a playing frame.
  const name = "bbb-10s.mp4";
  await page
    .getByRole("link", { name: new RegExp(name) })
    .first()
    .click();
  await page.getByRole("dialog").waitFor({ timeout: 30_000 });
  await sleep(3000); // let the video start and the frame settle

  await screenshotTo(page, path.join(assetsDir, "side-peek.png"));
} finally {
  await close();
}
