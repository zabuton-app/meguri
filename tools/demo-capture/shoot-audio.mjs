// Capture the audio screenshot (docs/assets/audio.png): a track playing in
// the bottom player bar while the library, with its cover-art tiles, is
// browsed above it. Needs the synthesised tracks from fetch-media.mjs and,
// like shoot-peek.mjs, a real display.
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

  // An audio thumbnail starts the track in the bar straight away (no detail
  // view opens for audio), so the bar is the only thing to wait for.
  await page
    .getByRole("link", { name: /Morning Coast\.mp3/ })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Audio player" })
    .waitFor({ timeout: 30_000 });
  await sleep(6000); // let the seek bar move away from zero

  await screenshotTo(page, path.join(assetsDir, "audio.png"));
} finally {
  await close();
}
