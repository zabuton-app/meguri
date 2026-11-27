import { _electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeTopDialog,
  openSettingsTab,
  profileArg,
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
      args: [profileArg(userDataDir)],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: root },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIndexedMedia(page, "cached.png");
    await waitForIdle(page);

    // Adds the pattern, or with null removes the one there is.
    const setPatterns = async (pattern: string | null) => {
      const dialog = await openSettingsTab(page, "Scan");
      if (pattern === null) {
        await dialog.getByRole("button", { name: "Remove pattern 1" }).click();
      } else {
        // The files it would hide are listed first, found by main in the
        // auto-tag worker as a scan would; then it is added to the list.
        await dialog.getByLabel("Pattern to add").fill(pattern);
        await expect(
          dialog
            .getByRole("list", { name: "Matching files" })
            .getByText("cache/cached.png"),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Add", exact: true }).click();
      }
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Scan exclusions saved.")).toBeVisible();
      await closeTopDialog(page);
    };
    const scanButtons = page.getByRole("button", { name: "Scan", exact: true });
    const scan = async () => {
      await scanButtons.filter({ hasText: "Scan" }).click();
      await waitForIdle(page);
    };

    // By name, the default kind.
    await setPatterns("cache");
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

    await setPatterns(null);
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

// A folder excluded from the folder view (#282): hidden at once, listed in
// the workspace's edit dialog, and back at the next scan once taken off.
test("excludes a folder from its card and includes it again from the workspace", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-media-"));
  const fixture = fs.readFileSync(
    path.join(process.cwd(), "e2e/fixtures/media/test.png"),
  );
  fs.mkdirSync(path.join(root, "keep"));
  fs.mkdirSync(path.join(root, "cache"));
  fs.writeFileSync(path.join(root, "keep", "kept.png"), fixture);
  fs.writeFileSync(
    path.join(root, "cache", "cached.png"),
    Buffer.concat([fixture, Buffer.from("cached")]),
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
    await waitForIndexedMedia(page, "cached.png");
    await waitForIdle(page);

    await page.getByRole("button", { name: "Show by folder" }).click();
    const cacheCard = page.locator('[data-folder-path="cache"]');
    await cacheCard.getByRole("button", { name: 'Open folder "cache"' }).click({
      button: "right",
    });
    await page.getByRole("menuitem", { name: "Exclude from scans" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Exclude" })
      .click();
    await expect(
      page.getByText("“cache” is excluded from scans"),
    ).toBeVisible();
    await expect(cacheCard).toHaveCount(0);
    await expect(page.locator('[data-folder-path="keep"]')).toBeVisible();

    await page.getByRole("button", { name: "Edit workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit workspace" });
    await dialog
      .getByRole("button", {
        name: `Include ${path.join(root, "cache")} in scans again`,
      })
      .click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await page
      .getByRole("button", { name: "Scan", exact: true })
      .filter({ hasText: "Scan" })
      .click();
    await waitForIdle(page);
    await expect(cacheCard).toBeVisible();
  } finally {
    try {
      await app.close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
