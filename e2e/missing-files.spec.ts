import { _electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  profileArg,
  skipFirstLaunchTour,
  waitForIdle,
  waitForIndexedMedia,
} from "./fixtures/helpers";
import {
  electronLaunchOptions,
  mainScript,
} from "../scripts/electron-launch.cjs";

// A file deleted from disk stays listed as missing until the user removes it
// (#277). Its own media folder, since the test deletes a file from it.
test("lists a file gone from disk and removes it on request", async () => {
  expect(fs.existsSync(mainScript)).toBe(true);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-media-"));
  const fixture = path.join(process.cwd(), "e2e/fixtures/media/test.png");
  fs.copyFileSync(fixture, path.join(root, "keep.png"));
  // Different content, so the scan does not take it for a copy of keep.png.
  fs.writeFileSync(
    path.join(root, "gone.png"),
    Buffer.concat([fs.readFileSync(fixture), Buffer.from("gone")]),
  );
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [profileArg(userDataDir)],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: root },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIndexedMedia(page, "gone.png");
    await waitForIdle(page);

    fs.rmSync(path.join(root, "gone.png"));
    const scanButtons = page.getByRole("button", { name: "Scan", exact: true });
    await scanButtons.filter({ hasText: "Scan" }).click();
    await waitForIdle(page);
    await expect(page.getByText("gone.png")).toHaveCount(0);

    // The menu beside it: the button with the label and no text. Opened from
    // the keyboard, as the scan's toast sits over it.
    await scanButtons.filter({ hasNotText: "Scan" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Missing files" }).click();
    const dialog = page.getByRole("dialog", { name: "Missing files" });
    await expect(dialog.getByText("gone.png")).toBeVisible();
    await expect(dialog.getByText("keep.png")).toHaveCount(0);

    await dialog.getByText("gone.png").click();
    await dialog.getByRole("button", { name: "Remove 1 selected" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByText("Removed 1 file")).toBeVisible();
    await expect(dialog.getByText("No missing files.")).toBeVisible();
  } finally {
    try {
      await app.close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
