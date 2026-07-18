// Capture the play-history view screenshot (docs/assets/history.png):
// play a few files to build up a history, then open the History modal.
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

  // Build up some history: open a few files (plays are recorded for both
  // videos and image views), each twice so play counts show up.
  const cards = page.getByTestId("media-card");
  const count = Math.min(await cards.count(), 4);
  for (const nth of [0, 1, 2, Math.min(3, count - 1), 1]) {
    await cards.nth(nth).click();
    await sleep(2200);
    await page.keyboard.press("Escape");
    await sleep(600);
  }

  await page.getByRole("link", { name: "Play history" }).click();
  await page
    .getByRole("dialog")
    .getByText("Play history", { exact: true })
    .waitFor({ timeout: 30_000 });
  await sleep(1500); // let thumbnails settle

  await screenshotTo(page, path.join(assetsDir, "history.png"));
} finally {
  await close();
}
