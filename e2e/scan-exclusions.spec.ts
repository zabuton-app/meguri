import { _electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeTopDialog,
  openSettingsTab,
  skipFirstLaunchTour,
  waitForIdle,
  waitForIndexedMedia,
} from "./fixtures/helpers";
import {
  electronLaunchOptions,
  mainScript,
} from "../scripts/electron-launch.cjs";

// A scan exclusion pattern (#282): saving it hides the indexed files it
// covers at once, a scan leaves them out and does not list them as missing,
// and taking it out brings them back at the next scan.
test("hides what a scan exclusion covers and brings it back when it goes", async () => {
  expect(fs.existsSync(mainScript)).toBe(true);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-media-"));
  const fixture = fs.readFileSync(
    path.join(process.cwd(), "e2e/fixtures/media/test.png"),
  );
  fs.mkdirSync(path.join(root, "keep"));
  fs.mkdirSync(path.join(root, "cache"));
  fs.writeFileSync(path.join(root, "keep", "kept.png"), fixture);
  // Different content, so neither is taken for a copy of the other.
  fs.writeFileSync(
    path.join(root, "cache", "cached.png"),
    Buffer.concat([fixture, Buffer.from("cached")]),
  );
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${userDataDir}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: root },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIndexedMedia(page, "cached.png");
    await waitForIdle(page);

    const setPatterns = async (text: string) => {
      const dialog = await openSettingsTab(page, "Scan");
      const field = dialog.getByLabel("Exclude from scans");
      await field.fill(text);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Scan exclusions saved.")).toBeVisible();
      await closeTopDialog(page);
    };
    const scanButtons = page.getByRole("button", { name: "Scan", exact: true });
    const scan = async () => {
      await scanButtons.filter({ hasText: "Scan" }).click();
      await waitForIdle(page);
    };

    await setPatterns("^cache/$");
    await expect(page.getByText("cached.png")).toHaveCount(0);
    await expect(page.getByText("kept.png")).toBeVisible();

    await scan();
    await expect(page.getByText("cached.png")).toHaveCount(0);
    await scanButtons.filter({ hasNotText: "Scan" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Missing files" }).click();
    const missing = page.getByRole("dialog", { name: "Missing files" });
    await expect(missing.getByText("No missing files.")).toBeVisible();
    await closeTopDialog(page);

    await setPatterns("");
    await scan();
    await expect(page.getByText("cached.png")).toBeVisible();
  } finally {
    try {
      await app.close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
