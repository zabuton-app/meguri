// Record the bulk edit GIF (docs/assets/bulk-edit.gif) and its still
// (bulk-edit.png): selecting several files, then rating, favoriting and
// tagging the whole selection from the selection bar.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  seedTags,
  showToasts,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

const card = (name) =>
  page.getByTestId("media-card").filter({ hasText: name }).first();

async function select(name) {
  await card(name).hover();
  await sleep(350);
  await card(name).getByRole("button", { name: "Select", exact: true }).click();
  await sleep(450);
}

try {
  await waitReady(page);
  await seedTags(page);
  await showToasts(page);

  const rec = await startRecording(page, path.join(assetsDir, "bulk-edit.gif"));
  await sleep(1000);

  // 1) pick a handful of files
  for (const name of [
    "photo-1.jpg",
    "photo-10.jpg",
    "photo-3.jpg",
    "photo-7.jpg",
  ]) {
    await select(name);
  }
  const bar = page.getByLabel("Selection actions");
  await bar.waitFor();
  await sleep(800);

  // 2) rate and favorite the whole selection
  await bar.getByRole("button", { name: "4 stars" }).click();
  await sleep(1300);
  await bar.getByRole("button", { name: "Favorite", exact: true }).click();
  await sleep(1300);
  await screenshotTo(page, path.join(assetsDir, "bulk-edit.png"));

  // 3) tag it in one go
  await bar.getByRole("button", { name: /Edit tags/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await sleep(900);
  await page.keyboard.type("wallpaper", { delay: 90 });
  await page.keyboard.press("Enter");
  await sleep(1100);
  await dialog.getByRole("button", { name: /^Apply to/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await sleep(2200);

  await bar.getByRole("button", { name: "Exit selection" }).click();
  await sleep(1500);

  await rec.stop();
} finally {
  await close();
}
