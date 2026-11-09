// Capture the sample CSS themes in docs/themes/ (docs/assets/css-theme-*.png),
// each in its dark and its light variant. A CSS theme picks its variant by the
// built-in theme's appearance (html[data-appearance]), so the built-in theme
// underneath is switched between a dark and a light one.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  repoRoot,
  resolveMediaRoot,
  screenshotTo,
  selectCssTheme,
  setTheme,
  waitReady,
} from "./lib.mjs";

const THEMES = ["cyberpunk", "oled", "high-contrast", "sky"];
const VARIANTS = { dark: "solarized-dark", light: "solarized-light" };

const { page, close } = await launchApp({
  mediaRoot: resolveMediaRoot(),
  themeFiles: THEMES.map((name) =>
    path.join(repoRoot, "docs/themes", `${name}.css`),
  ),
});

try {
  await waitReady(page);
  for (const name of THEMES) {
    await selectCssTheme(page, `${name}.css`);
    for (const [variant, base] of Object.entries(VARIANTS)) {
      await setTheme(page, base);
      await screenshotTo(
        page,
        path.join(assetsDir, `css-theme-${name}-${variant}.png`),
      );
    }
  }
} finally {
  await close();
}
