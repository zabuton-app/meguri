// Record the Discovery showcase GIF (docs/assets/discover.gif):
// carousel navigation, scene previews, reshuffle.
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

  // open Discovery before recording so the GIF stars the modal itself
  await page.getByRole("link", { name: "Discovery" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Discovery", { exact: true })
    .waitFor({ timeout: 30_000 });
  await sleep(1000);

  const rec = await startRecording(page, path.join(assetsDir, "discover.gif"));
  await sleep(1500);

  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("ArrowRight");
    await sleep(1300);
  }

  await page.getByRole("button", { name: "Reshuffle" }).click();
  await sleep(2000);
  await page.keyboard.press("ArrowRight");
  await sleep(1300);

  const playBtn = dialog.getByRole("button", { name: "Play", exact: true });
  if (await playBtn.isVisible().catch(() => false)) {
    await playBtn.click();
    await sleep(4000);
  } else {
    await page.keyboard.press("ArrowRight");
    await sleep(1500);
  }

  await rec.stop();
} finally {
  await close();
}
