import { expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const FIXTURE_FILE = "test.png";

/**
 * The `--user-data-dir` argument for a launch, with the background update
 * check turned off in that profile. The built app reports version 0.0, so
 * wherever GitHub is reachable (CI) every release is newer, and the toast that
 * appears about 8 seconds after launch sits over the top right of the window
 * and takes clicks meant for what is under it (#535). A test should not depend
 * on the network either. The shape is UpdateConfig in
 * electron/core/appConfig.ts; every other field defaults.
 */
export function profileArg(userDataDir: string): string {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "config.json"),
    JSON.stringify({ update: { autoCheck: false } }),
  );
  return `--user-data-dir=${userDataDir}`;
}

export async function waitForRenderer(page: Page): Promise<void> {
  // Electron can expose the initial blank page before it loads the app.
  await page.waitForURL(/\/out\/renderer\/index\.html(?:[?#].*)?$/, {
    waitUntil: "domcontentloaded",
  });
}

export function statusBar(page: Page): Locator {
  return page.getByRole("contentinfo", { name: "Status bar" });
}

/** The search in the title bar: it shows the search and opens the command menu. */
export function searchTrigger(page: Page): Locator {
  return page.locator('[data-slot="search-trigger"]');
}

/** Search the library for `text`, typed in the command menu as a user does. */
export async function searchFor(page: Page, text: string): Promise<void> {
  await searchTrigger(page)
    .getByRole("button", { name: "Search or run a command" })
    .click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(searchTrigger(page)).toContainText(text);
}

/** The exact-tag directives the search box renders as chips beside the text. */
export function searchChips(page: Page): Locator {
  return page.locator('[data-slot="search-chip"]');
}

/** Grid-view card for a file. The list view doesn't carry the testid. */
export function fileCard(page: Page, fileName = FIXTURE_FILE): Locator {
  return page.getByTestId("media-card").filter({ hasText: fileName }).first();
}

/** Wait until the initial scan surfaces the fixture file in the grid. */
export async function waitForIndexedMedia(
  page: Page,
  fileName = FIXTURE_FILE,
): Promise<void> {
  await expect(page.getByText(fileName).first()).toBeVisible({
    timeout: 60_000,
  });
}

export async function waitForIdle(page: Page): Promise<void> {
  await expect(statusBar(page)).toContainText("Idle", { timeout: 60_000 });
}

export async function openFileDetail(
  page: Page,
  fileName = FIXTURE_FILE,
): Promise<Locator> {
  await waitForIndexedMedia(page, fileName);
  await page
    .getByRole("link", { name: new RegExp(fileName) })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: fileName })).toBeVisible();
  return dialog;
}

export async function closeTopDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Settings", { exact: true })).toBeVisible();
  return dialog;
}

/**
 * Opens settings and switches to one of its tabs. Only the selected tab's panel
 * is mounted, so anything outside the first tab has to be reached this way.
 */
export async function openSettingsTab(
  page: Page,
  name: string,
): Promise<Locator> {
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name, exact: true }).click();
  return dialog;
}

export async function openDiscover(page: Page): Promise<Locator> {
  await page.getByRole("link", { name: "Discovery" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Discovery", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return dialog;
}

export async function openCommandMenu(page: Page): Promise<void> {
  await page.keyboard.press("Control+KeyK");
  await expect(
    page.getByPlaceholder("Search files, or type a command..."),
  ).toBeVisible();
}

/** Assert that a RatingStars control shows the given value (1–5). */
export async function expectStarRating(
  scope: Locator,
  stars: number,
): Promise<void> {
  for (let n = 1; n <= 5; n += 1) {
    const icon = scope
      .getByRole("button", { name: `${n} stars` })
      .locator("svg");
    if (n <= stars) {
      await expect(icon).toHaveClass(/fill-accent2/);
    } else {
      await expect(icon).not.toHaveClass(/fill-accent2/);
    }
  }
}

/**
 * Every test starts from a fresh profile, which is a first launch: mark the
 * first-launch tour as seen and reload, or its overlay would sit over the test.
 */
export async function skipFirstLaunchTour(page: Page): Promise<void> {
  await waitForRenderer(page);
  await page.evaluate(() =>
    localStorage.setItem("meguri.tours", JSON.stringify(["first-launch"])),
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}
