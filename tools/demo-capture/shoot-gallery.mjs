// Capture the README gallery screenshots (docs/assets/*.png):
// list/table view modes plus a few theme variations of the grid.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  setTheme,
  sleep,
  waitReady,
} from "./lib.mjs";

const THEMES = ["gruvbox-dark", "nord-dark", "solarized-light"];

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

try {
  await waitReady(page);

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await screenshotTo(page, path.join(assetsDir, `theme-${theme}.png`));
  }

  await setTheme(page, THEMES[0]);
  for (const [label, name] of [
    ["List view", "view-list"],
    ["Table view", "view-table"],
  ]) {
    await page.getByRole("button", { name: label }).click();
    await sleep(800);
    await screenshotTo(page, path.join(assetsDir, `${name}.png`));
  }
} finally {
  await close();
}
