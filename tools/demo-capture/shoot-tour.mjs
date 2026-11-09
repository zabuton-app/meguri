// Capture the first-launch tour (docs/assets/tour.png): the pet presenting
// one of its steps, with the part of the screen it explains cut out of the
// dimmed overlay.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  sleep,
} from "./lib.mjs";

const STEP = "Search and filter";

const { page, close } = await launchApp({
  mediaRoot: resolveMediaRoot(),
  seenTours: [],
});

try {
  // The tour starts on the bare list once the library is there, with the
  // language picker first.
  await page
    .getByRole("dialog", { name: "Choose your language" })
    .waitFor({ timeout: 120_000 });
  const next = page.getByRole("button", { name: "Next" });
  const step = page.getByRole("dialog", { name: STEP });
  for (let i = 0; i < 10 && !(await step.isVisible()); i++) {
    await next.click();
    await sleep(600);
  }
  await step.waitFor();
  // Let the pet land and the cut-out settle.
  await sleep(2000);
  await screenshotTo(page, path.join(assetsDir, "tour.png"));
} finally {
  await close();
}
