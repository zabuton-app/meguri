import { test, expect } from "./fixtures/app";
import {
  FIXTURE_FILE,
  closeTopDialog,
  searchChips,
  waitForIndexedMedia,
} from "./fixtures/helpers";

test.describe("Tags", () => {
  test("opens from the header and closes with Escape", async ({ ready }) => {
    // exact: the accessible name of a card with no manual tags contains "No
    // tags", which a substring match picks up too.
    await ready.getByRole("link", { name: "Tags", exact: true }).click();
    const dialog = ready.getByRole("dialog");
    await expect(dialog.getByText("Tags", { exact: true })).toBeVisible();
    await closeTopDialog(ready);
    await expect(ready).toHaveURL(/#\/$/);
  });

  test("opens from the command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyK");
    await ready.getByText("Tags", { exact: true }).click();
    await expect(ready).toHaveURL(/#\/tags$/);
    await closeTopDialog(ready);
  });

  test("lists the tags the scan generated and filters the library from one", async ({
    ready,
  }) => {
    // The fixture is an image, so the classifier gives it resolution and orientation.
    await waitForIndexedMedia(ready);
    // exact: the accessible name of a card with no manual tags contains "No
    // tags", which a substring match picks up too.
    await ready.getByRole("link", { name: "Tags", exact: true }).click();
    const dialog = ready.getByRole("dialog");
    // The group header, not the row label under it, which reads "Resolution: sd".
    await expect(
      dialog.getByRole("button", { name: "Resolution", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    // Generated tags are read-only.
    await expect(dialog.getByText("Read-only").first()).toBeVisible();

    await dialog.getByText("res:", { exact: false }).first().click();
    await expect(ready).toHaveURL(/#\/$/);
    // The directive lands in the search box as one chip, removable in one click.
    await expect(searchChips(ready)).toHaveCount(1);
  });

  test("filters the library from a tag in the detail view", async ({
    ready,
  }) => {
    await waitForIndexedMedia(ready);
    await ready.getByText(FIXTURE_FILE).first().click();
    const dialog = ready.getByRole("dialog");
    // Generated tags are only visible here, so this is where they are clicked.
    await dialog.getByText("res:", { exact: false }).first().click();

    await expect(ready).toHaveURL(/#\/$/);
    const chip = searchChips(ready);
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("tag:");

    // Removing it takes the whole directive, not a character of it.
    await chip.getByRole("button").click();
    await expect(searchChips(ready)).toHaveCount(0);
  });
});
