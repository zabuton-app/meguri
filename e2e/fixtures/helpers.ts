import { expect, type Locator, type Page } from "@playwright/test";

export const FIXTURE_FILE = "test.png";

export function statusBar(page: Page): Locator {
  return page.getByRole("contentinfo", { name: "Status bar" });
}

export function searchInput(page: Page): Locator {
  return page.locator("#list-search-input");
}

/** The exact-tag directives the search box renders as chips beside the text. */
export function searchChips(page: Page): Locator {
  return page.locator('[data-slot="search-chip"]');
}

/** Grid-view card for a file. List/table views don't carry the testid. */
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
  await page.getByTitle("Settings").click();
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
  await expect(page.getByPlaceholder("Search commands...")).toBeVisible();
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
