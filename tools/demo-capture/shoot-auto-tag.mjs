// Capture the auto-tagging screen (docs/assets/auto-tag.png). The sample
// library's names (photo-1.jpg, …) carry nothing to tag by, so this builds its
// own: generated images under names with codes, brackets and repeated words,
// in a couple of folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assetsDir,
  ffmpegPath,
  launchApp,
  screenshotTo,
  sleep,
  waitReady,
} from "./lib.mjs";

const NAMES = [
  "Trips/ABCD-101 [Kyoto] temple at dawn.jpg",
  "Trips/ABCD-102 [Kyoto] moss garden.jpg",
  "Trips/ABCD-103 [Nara] deer park.jpg",
  "Trips/ABCD-104 [Nara] pagoda.jpg",
  "Trips/WXYZ-201 [Osaka] night market.jpg",
  "Trips/WXYZ-202 [Osaka] river walk.jpg",
  "Home/Family picnic in the park.jpg",
  "Home/Family dinner.jpg",
  "Home/Garden flowers in spring.jpg",
  "Home/Garden pond.jpg",
  "Beach sunset.jpg",
  "Beach morning walk.jpg",
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-auto-tag-"));
const mediaRoot = path.join(root, "Pictures");
NAMES.forEach((name, i) => {
  const dest = path.join(mediaRoot, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync(ffmpegPath, [
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", `gradients=s=640x426:seed=${i + 1}:speed=0`,
    "-frames:v", "1",
    dest,
  ]);
});

const { page, close } = await launchApp({ mediaRoot });

try {
  await waitReady(page);
  await page.getByRole("link", { name: "Auto tagging" }).click();
  // The rules ship off: turn on the code prefix and the square brackets, and
  // open the first with only the files it would tag.
  const toggles = page.getByRole("switch", { name: "Enable rule" });
  await toggles.nth(0).click();
  await toggles.nth(1).click();
  await page.getByText("Code prefix", { exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Matches only" }).check();
  await page
    .getByText(/would be tagged/)
    .first()
    .waitFor({ timeout: 30_000 });
  await sleep(1000);
  await screenshotTo(page, path.join(assetsDir, "auto-tag.png"));
} finally {
  await close();
  fs.rmSync(root, { recursive: true, force: true });
}
