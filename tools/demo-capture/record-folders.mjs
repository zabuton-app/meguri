// Record the folder view GIF (docs/assets/folders.gif) and its still
// (view-folders.png): the library shown by folder, stepping into one, back up,
// and jumping to a sibling from the subfolder menu.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  seedTags,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

const folderCard = (name) =>
  page.getByTestId("folder-card").filter({ hasText: name }).first();

try {
  await waitReady(page);
  await seedTags(page);

  const rec = await startRecording(page, path.join(assetsDir, "folders.gif"));
  await sleep(1200);

  // 1) switch the grid to folders
  await page.getByRole("button", { name: "Show by folder" }).click();
  await folderCard("Nature").waitFor();
  await sleep(1200);
  for (const name of ["Animation", "Music", "Nature"]) {
    await folderCard(name).hover();
    await sleep(600);
  }
  await screenshotTo(page, path.join(assetsDir, "view-folders.png"));

  // 2) into a folder, and back up
  await folderCard("Nature").click();
  await page.getByTestId("media-card").first().waitFor();
  await sleep(2200);
  await page.getByRole("button", { name: "Up one level" }).click();
  await folderCard("Animation").waitFor();
  await sleep(1000);

  // 3) jump straight to a subfolder from the breadcrumb menu
  await page.getByRole("button", { name: /^Subfolders of/ }).click();
  await sleep(1000);
  await page.getByRole("menuitem", { name: "Animation" }).click();
  await page.getByTestId("media-card").first().waitFor();
  await sleep(2200);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await sleep(1200);

  await rec.stop();
} finally {
  await close();
}
