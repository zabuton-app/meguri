// Capture the auto-tagging screen and the tag cloud it fills:
//   auto-tag.png          — the Regex tab, the code-prefix rule's files
//   auto-tag-keywords.png — the Keywords tab, a keyword and the files it finds
//   auto-tag-suggest.png  — the Suggestions tab, words no condition covers yet
//   tags-cloud.png        — the Tags screen's cloud, after the conditions ran
// The sample library's names (photo-1.jpg, …) carry nothing to tag by, so this
// builds its own: generated images under names with codes, brackets and
// repeated words, in a couple of folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assetsDir,
  ffmpegPath,
  hideToasts,
  launchApp,
  screenshotTo,
  sleep,
  waitReady,
} from "./lib.mjs";

const NAMES = [
  "Trips/ABCD-101 [Kyoto] temple at dawn.jpg",
  "Trips/ABCD-102 [Kyoto] moss garden.jpg",
  "Trips/ABCD-103 [Kyoto] bamboo forest.jpg",
  "Trips/ABCD-104 [Kyoto] temple gate.jpg",
  "Trips/ABCD-105 [Nara] deer park.jpg",
  "Trips/ABCD-106 [Nara] pagoda.jpg",
  "Trips/ABCD-107 [Nara] temple bell.jpg",
  "Trips/WXYZ-201 [Osaka] night market.jpg",
  "Trips/WXYZ-202 [Osaka] river walk.jpg",
  "Trips/WXYZ-203 [Osaka] castle.jpg",
  "Trips/QRST-301 [Hokkaido] snow festival.jpg",
  "Trips/QRST-302 [Hokkaido] lavender field.jpg",
  "Home/Family picnic in the park.jpg",
  "Home/Family dinner.jpg",
  "Home/Family birthday cake.jpg",
  "Home/Garden flowers in spring.jpg",
  "Home/Garden pond.jpg",
  "Home/Garden cat sleeping.jpg",
  "Home/Cat on the sofa.jpg",
  "Home/Cat in the snow.jpg",
  "Beach sunset.jpg",
  "Beach morning walk.jpg",
  "Beach sunset with friends.jpg",
  "Mountain sunrise.jpg",
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-auto-tag-"));
const mediaRoot = path.join(root, "Pictures");
NAMES.forEach((name, i) => {
  const dest = path.join(mediaRoot, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync(ffmpegPath, [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `gradients=s=640x426:seed=${i + 1}:speed=0`,
    "-frames:v",
    "1",
    dest,
  ]);
});

const { page, close } = await launchApp({ mediaRoot });

try {
  await waitReady(page);
  await page.getByRole("link", { name: "Auto tagging" }).click();
  const dialog = page.getByRole("dialog");

  // The rules ship off: turn on the code prefix and the square brackets, and
  // open the first with only the files it would tag.
  const toggles = dialog.getByRole("switch", { name: "Enable rule" });
  await toggles.nth(0).click();
  await toggles.nth(1).click();
  await dialog.getByText("Code prefix", { exact: true }).first().click();
  await dialog.getByRole("checkbox", { name: "Matches only" }).check();
  await dialog
    .getByText(/would be tagged/)
    .first()
    .waitFor({ timeout: 30_000 });
  await sleep(1000);
  await screenshotTo(page, path.join(assetsDir, "auto-tag.png"));

  // Keywords: a few terms, each with the tag it adds. The last one added is
  // the one left open, with the files it finds.
  await dialog.getByRole("tab", { name: "Keywords" }).click();
  const add = dialog.getByLabel(/Add a keyword/);
  for (const keyword of ["Beach", "Garden", "Cat"]) {
    await add.fill(keyword);
    await add.press("Enter");
    await dialog.getByText("Matching files").first().waitFor();
  }
  await sleep(1000);
  await screenshotTo(page, path.join(assetsDir, "auto-tag-keywords.png"));

  // Run the rules and the keywords over the library, so the suggestions leave
  // out what they cover and the tag screen has tags to draw.
  await dialog.getByRole("button", { name: "Apply to existing files" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Apply to existing files" })
    .click();
  await dialog.getByText(/^Added \d+ tags to \d+ files/).waitFor({
    timeout: 30_000,
  });
  await hideToasts(page);

  await dialog.getByRole("tab", { name: "Suggestions" }).click();
  await sleep(1500);
  await screenshotTo(page, path.join(assetsDir, "auto-tag-suggest.png"));

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Tags", exact: true }).click();
  const tags = page.getByRole("dialog");
  await tags.getByRole("radio", { name: "Cloud" }).click();
  await sleep(1500);
  await screenshotTo(page, path.join(assetsDir, "tags-cloud.png"));
} finally {
  await close();
  fs.rmSync(root, { recursive: true, force: true });
}
