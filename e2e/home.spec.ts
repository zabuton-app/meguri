import { test, expect } from "./fixtures/app";
import {
  fileCard,
  searchInput,
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
    // under the control being clicked.
    await waitForIdle(ready);
    await ready.getByRole("radio", { name: "Image" }).click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await ready.getByRole("radio", { name: "Video" }).click();
    await expect(ready.getByText("No media to display.")).toBeVisible();

    await ready.getByRole("radio", { name: "All" }).click();
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
    // Sort now lives behind the "More conditions" panel, so it has to be opened
    // before the direction toggle exists.
    await ready.getByRole("button", { name: "More conditions" }).click();
    await ready.getByRole("button", { name: "Ascending" }).click();
    await expect(
      ready.getByRole("button", { name: "Descending" }),
    ).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("picks a play state from the panel and keeps it after closing", async ({
    ready,
  }) => {
    await waitForIdle(ready);
    await ready.getByRole("button", { name: "More conditions" }).click();
    const panel = ready.locator('[data-slot="more-filters-panel"]');
    await panel.getByRole("radio", { name: "Unplayed" }).click();
    await expect(panel).toBeVisible();

    await ready.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    // The condition survives the panel closing, and the badge reports it.
    await expect(ready.locator('[data-slot="more-filters-badge"]')).toHaveText(
      "1",
    );
  });

  test("reports a changed sort as a named chip, not just a count", async ({
    ready,
  }) => {
    await waitForIdle(ready);
    await ready.getByRole("button", { name: "More conditions" }).click();
    const panel = ready.locator('[data-slot="more-filters-panel"]');
    await panel.getByRole("button", { name: "Ascending" }).click();
    await ready.keyboard.press("Escape");

    // The count says something is set; the chip says what.
    await expect(ready.locator('[data-slot="more-filters-badge"]')).toHaveText(
      "1",
    );
    const chip = ready.locator('[data-slot="filter-chip"]');
    await expect(chip).toContainText("Sort order");

    await chip.getByRole("button", { name: "Remove this filter" }).click();
    await expect(chip).toHaveCount(0);
    await expect(ready.locator('[data-slot="more-filters-badge"]')).toHaveCount(
      0,
    );
  });

  test("picks a sort key from the panel without dismissing it", async ({
    ready,
  }) => {
    // A select nested inside a popover puts two dismiss layers in the same
    // subtree; selecting an option must not take the whole panel down with it.
    await waitForIdle(ready);
    await ready.getByRole("button", { name: "More conditions" }).click();
    const panel = ready.locator('[data-slot="more-filters-panel"]');
    await panel.locator('[data-slot="select-trigger"]').click();
    await ready.getByRole("option", { name: "Name" }).click();

    await expect(panel).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("keeps the panel open when Escape closes a nested select", async ({
    ready,
  }) => {
    await waitForIdle(ready);
    await ready.getByRole("button", { name: "More conditions" }).click();
    const panel = ready.locator('[data-slot="more-filters-panel"]');
    await panel.locator('[data-slot="select-trigger"]').click();
    await expect(ready.getByRole("option", { name: "Name" })).toBeVisible();

    await ready.keyboard.press("Escape");

    // Only the dropdown goes; backing out of a select is not a request to close
    // everything behind it.
    await expect(ready.getByRole("option", { name: "Name" })).toBeHidden();
    await expect(panel).toBeVisible();
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
