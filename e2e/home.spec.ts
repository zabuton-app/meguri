import { test, expect } from "./fixtures/app";
import {
  fileCard,
  searchInput,
  selectComboboxOption,
  statusBar,
  waitForIdle,
  expectStarRating,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Home", () => {
  test("launches and indexes fixture media", async ({ window }) => {
    await expect(window).toHaveTitle(/^Meguri/);
    await expect(statusBar(window)).toBeVisible();
    await expect(window.getByText(FIXTURE_FILE)).toBeVisible({
      timeout: 60_000,
    });
    await expect(statusBar(window)).toContainText("1 files");
    await expect(statusBar(window)).toContainText("Idle");
  });

  test("manual rescan completes", async ({ ready }) => {
    await ready
      .getByRole("button", { name: "Scan" })
      .filter({ hasText: "Scan" })
      .click();
    await waitForIdle(ready);
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("switches grid, list, and table views", async ({ ready }) => {
    for (const mode of ["Grid view", "List view", "Table view"] as const) {
      await ready.getByRole("button", { name: mode }).click();
      await expect(
        ready.getByRole("button", { name: mode, pressed: true }),
      ).toBeVisible();
      await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
    }
  });

  test("filters files by search query", async ({ ready }) => {
    const input = searchInput(ready);
    await input.fill("test");
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await input.fill("nomatch-xyz");
    await expect(ready.getByText("No media to display.")).toBeVisible();

    await input.fill("");
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("filters by media kind", async ({ ready }) => {
    // The scan now derives tags as well, so it is still finishing when the
    // fixture reports ready and its completion re-renders the bar out from
    // under the open dropdown. Every other select test already waits.
    await waitForIdle(ready);
    await selectComboboxOption(ready, 0, "Image");
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await selectComboboxOption(ready, 0, "Video");
    await expect(ready.getByText("No media to display.")).toBeVisible();

    await selectComboboxOption(ready, 0, "All");
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("filters favorites and clears chips", async ({ ready }) => {
    const card = fileCard(ready);
    await card.hover();
    await card.getByRole("button", { name: "Add to favorites" }).click();

    await ready.getByRole("button", { name: "Show favorites only" }).click();
    await expect(ready.getByText("♥ Favorites")).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await ready.getByRole("button", { name: "Remove this filter" }).click();
    await expect(ready.getByText("♥ Favorites")).toHaveCount(0);
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("filters by minimum rating", async ({ ready }) => {
    const card = fileCard(ready);
    await card.getByRole("button", { name: "4 stars" }).click();

    await ready
      .locator('[title="Filter by minimum rating"]')
      .getByRole("button", { name: "5 stars" })
      .click();
    await expect(ready.getByText("No media to display.")).toBeVisible();

    await ready
      .locator('[title="Filter by minimum rating"]')
      .getByRole("button", { name: "4 stars" })
      .click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("toggles sort direction", async ({ ready }) => {
    await ready.getByRole("button", { name: "Ascending" }).click();
    await expect(
      ready.getByRole("button", { name: "Descending" }),
    ).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("toggles favorite on grid card", async ({ ready }) => {
    const card = fileCard(ready);
    await card.hover();
    await card.getByRole("button", { name: "Add to favorites" }).click();
    await expect(
      card.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();
  });

  test("sets rating from grid card", async ({ ready }) => {
    const card = fileCard(ready);
    await card.getByRole("button", { name: "3 stars" }).click();
    await expectStarRating(card, 3);
  });
});
