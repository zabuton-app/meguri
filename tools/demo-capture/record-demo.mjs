// Record the README overview GIF (docs/assets/demo.gif):
// browse the grid, search, play a video, open Discovery.
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

try {
  await waitReady(page);
  const rec = await startRecording(page, path.join(assetsDir, "demo.gif"));
  await sleep(1200);

  // 1) scroll the grid
  await page.locator("main").first().hover().catch(() => {});
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 120);
    await sleep(220);
  }
  await sleep(400);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, -120);
    await sleep(160);
  }
  await sleep(600);

  // 2) incremental search
  const search = page.locator("#list-search-input");
  await search.click();
  await search.pressSequentially("jellyfish", { delay: 90 });
  await sleep(1400);
  await search.fill("");
  await page.keyboard.press("Escape");
  await sleep(700);

  // 3) open a video detail and let it play
  const videoCard = page
    .getByTestId("media-card")
    .filter({ hasText: ".mp4" })
    .first();
  await videoCard.hover();
  await sleep(600);
  const name = (await videoCard.innerText()).match(/\S+\.mp4/)?.[0] ?? ".mp4";
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.getByRole("dialog").waitFor();
  await sleep(4500);
  await page.keyboard.press("Escape");
  await sleep(800);

  // 4) Discovery
  await page.getByRole("link", { name: "Discovery" }).click();
  await page
    .getByRole("dialog")
    .getByText("Discovery", { exact: true })
    .waitFor({ timeout: 30_000 });
  await sleep(4000);
  await page.keyboard.press("Escape");
  await sleep(1000);

  await rec.stop();
} finally {
  await close();
}
