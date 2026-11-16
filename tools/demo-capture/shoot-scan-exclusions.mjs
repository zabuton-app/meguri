// Capture the scan exclusion screens (#282, #529):
//   scan-exclusions-patterns.png  — Settings → Scan, a name pattern being
//                                   typed, with the files it would hide
//   scan-exclusions-confirm.png   — excluding a folder from the folder view
//   scan-exclusions-workspace.png — the workspace's excluded folders, one of
//                                   them about to be included again
// Builds its own library: generated images, with the clutter exclusions are
// for (a NAS's @eaDir thumbnail folders, render caches, a private folder).
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
  "Trips/Kyoto temple.jpg",
  "Trips/Nara deer park.jpg",
  "Trips/Osaka night market.jpg",
  "Trips/Hokkaido lavender.jpg",
  "Trips/@eaDir/Kyoto temple.jpg/SYNOFILE_THUMB_XL.jpg",
  "Trips/@eaDir/Nara deer park.jpg/SYNOFILE_THUMB_XL.jpg",
  "Family/Picnic in the park.jpg",
  "Family/Birthday cake.jpg",
  "Family/@eaDir/Picnic in the park.jpg/SYNOFILE_THUMB_XL.jpg",
  "Projects/Final cut.jpg",
  "Projects/renders/shot-010.jpg",
  "Projects/renders/shot-020.jpg",
  "Projects/cache/preview-001.jpg",
  "Projects/cache/preview-002.jpg",
  "Projects/cache/preview-003.jpg",
  "private/Notes 1.jpg",
  "private/Notes 2.jpg",
  "Beach sunset.jpg",
  "Mountain sunrise.jpg",
];

// The path shows in the captures: a plain one, unless it is taken.
const plain = path.join(os.tmpdir(), "Pictures");
const root = fs.existsSync(plain)
  ? fs.mkdtempSync(path.join(os.tmpdir(), "meguri-exclusions-"))
  : null;
const mediaRoot = root ? path.join(root, "Pictures") : plain;
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

  // Folder view: exclude the render caches, as the right-click menu does.
  await page.getByRole("button", { name: "Show by folder" }).click();
  await page
    .getByRole("button", { name: 'Open folder "Projects"' })
    .first()
    .click();
  const exclude = async (folder) => {
    await page
      .getByRole("button", { name: `Open folder "${folder}"` })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Exclude from scans" }).click();
    return page.getByRole("alertdialog");
  };
  const confirm = await exclude("cache");
  await confirm.getByText(/files in it are hidden/).waitFor();
  await sleep(500);
  await screenshotTo(page, path.join(assetsDir, "scan-exclusions-confirm.png"));
  await confirm.getByRole("button", { name: "Exclude" }).click();
  await (
    await exclude("renders")
  )
    .getByRole("button", { name: "Exclude" })
    .click();
  await hideToasts(page);

  // The workspace's list, with one folder taken off (staged until Save).
  await page.getByRole("button", { name: "Edit workspace" }).click();
  const edit = page.getByRole("dialog", { name: "Edit workspace" });
  await edit
    .getByRole("button", {
      name: `Include ${path.join(mediaRoot, "Projects", "renders")} in scans again`,
    })
    .click();
  await sleep(500);
  await screenshotTo(
    page,
    path.join(assetsDir, "scan-exclusions-workspace.png"),
  );
  await edit.getByRole("button", { name: "Cancel" }).click();

  // Settings → Scan: a common pattern saved, a name being typed, and the
  // files it would hide.
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("tab", { name: "Scan", exact: true }).click();
  await settings.getByRole("button", { name: "Use Synology @eaDir" }).click();
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await settings.getByRole("button", { name: "Save" }).click();
  await settings.getByLabel("Pattern to add").fill("private");
  await settings
    .getByRole("list", { name: "Matching files" })
    .waitFor({ timeout: 30_000 });
  await sleep(500);
  await screenshotTo(
    page,
    path.join(assetsDir, "scan-exclusions-patterns.png"),
  );
} finally {
  await close();
  fs.rmSync(root ?? mediaRoot, { recursive: true, force: true });
}
