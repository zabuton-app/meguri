import { test, expect } from "./fixtures/app";
import {
  fileCard,
  openFileDetail,
  searchInput,
  waitForIndexedMedia,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Collections", () => {
  test("creates a user collection from sidebar", async ({ ready }) => {
    await ready
      .getByRole("button", { name: "Create user collection" })
      .click();
    const dialog = ready.getByRole("dialog");
    await expect(dialog.getByText("Create user collection")).toBeVisible();
    await dialog
      .getByPlaceholder("Collection name")
      .fill("E2E Picks");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      ready.getByRole("button", { name: "E2E Picks" }),
    ).toBeVisible();
  });

  test("adds file to user collection from detail", async ({ ready }) => {
    await ready
      .getByRole("button", { name: "Create user collection" })
      .click();
    await ready.getByPlaceholder("Collection name").fill("Detail Collection");
    await ready.getByRole("button", { name: "Create" }).click();

    await ready.getByRole("button", { name: "media" }).click();
    await waitForIndexedMedia(ready);

    const detail = await openFileDetail(ready);
    await detail.getByRole("button", { name: "Add to collection" }).click();
    await ready
      .getByRole("menuitem", { name: 'Add to "Detail Collection"' })
      .click();
    await expect(
      ready.getByText('Added to "Detail Collection"'),
    ).toBeVisible();

    await detail.getByRole("button", { name: "Add to collection" }).click();
    await expect(
      ready.getByRole("menuitem", { name: 'Remove from "Detail Collection"' }),
    ).toBeVisible();
  });

  test("switches to empty user collection", async ({ ready }) => {
    await ready
      .getByRole("button", { name: "Create user collection" })
      .click();
    await ready.getByPlaceholder("Collection name").fill("Empty Collection");
    await ready.getByRole("button", { name: "Create" }).click();
    await ready.getByRole("button", { name: "Empty Collection" }).click();
    await expect(ready.getByText("No media to display.")).toBeVisible();
  });

  test("saves and applies a smart collection", async ({ ready }) => {
    await searchInput(ready).fill("test");
    await ready.getByRole("button", { name: "Smart collections" }).click();
    await ready.getByText("Save current filters").click();
    const saveDialog = ready.getByRole("dialog");
    await saveDialog.getByPlaceholder("Collection name").fill("PNG search");
    await saveDialog.getByRole("button", { name: "Save" }).click();

    await searchInput(ready).fill("nomatch");
    await expect(ready.getByText("No media to display.")).toBeVisible();

    await ready.getByRole("button", { name: "Smart collections" }).click();
    await ready.getByText("PNG search").click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("saves and reapplies favorites smart collection", async ({ ready }) => {
    const card = fileCard(ready);
    await card.hover();
    await card.getByRole("button", { name: "Add to favorites" }).click();
    await ready.getByRole("button", { name: "Show favorites only" }).click();

    await ready.getByRole("button", { name: "Smart collections" }).click();
    await ready.getByText("Save current filters").click();
    const saveDialog = ready.getByRole("dialog");
    await saveDialog.getByPlaceholder("Collection name").fill("E2E Favorites");
    await saveDialog.getByRole("button", { name: "Save" }).click();

    await ready.getByText("Clear all").click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await ready.getByRole("button", { name: "Smart collections" }).click();
    await ready.getByText("E2E Favorites").click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
    await expect(ready.getByText("♥ Favorites")).toBeVisible();
  });
});
