import { test, expect } from "./fixtures/app";
import { closeTopDialog, fileCard, searchInput } from "./fixtures/helpers";

test.describe("Auto tagging", () => {
  test("opens from the header and closes with Escape", async ({ ready }) => {
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    const dialog = ready.getByRole("dialog");
    await expect(dialog.getByText("Pattern rules")).toBeVisible();
    await closeTopDialog(ready);
    await expect(ready).toHaveURL(/#\/$/);
  });

  test("tags a file from a dictionary entry", async ({ ready }) => {
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    const dialog = ready.getByRole("dialog");

    // The fixture is "test.png": register its name as a keyword.
    const add = dialog.getByLabel(/Add a keyword/);
    await add.fill("Test");
    await add.press("Enter");
    await expect(dialog.getByText("Creates a new tag")).toBeVisible();

    // It shows up as a suggestion; applying it tags the file for real.
    await dialog.getByRole("tab", { name: /Suggested Keywords/ }).click();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByText("✓ Applied")).toBeVisible();

    await dialog.getByRole("tab", { name: "Sort terms" }).click();

    // The tag is the user's own: the tag screen lists it like any other.
    await closeTopDialog(ready);
    await ready.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(
      ready.getByRole("dialog").getByText("Test", { exact: true }),
    ).toBeVisible();
    await closeTopDialog(ready);

    // Reopened, the screen is where it was left: the same tab is a click
    // away, and the apply made before can still be taken back.
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    await dialog.getByRole("tab", { name: /Suggested Keywords/ }).click();
    await expect(dialog.getByText("✓ Applied")).toBeVisible();
    await dialog.getByRole("button", { name: "Undo" }).click();

    // Taken back, the entry reads as registered — it is in the dictionary, so
    // it is not offered as a suggestion — with the file left to apply it to.
    await expect(dialog.getByText("In keywords")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Apply", exact: true }),
    ).toBeVisible();
  });

  test("searches the library for a keyword's terms", async ({ ready }) => {
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    const dialog = ready.getByRole("dialog");
    const add = dialog.getByLabel(/Add a keyword/);
    // The alias matches the fixture ("test.png"); the tag itself does not.
    await add.fill("Sample, test");
    await add.press("Enter");
    await dialog.getByRole("button", { name: "Search the library" }).click();

    await expect(ready).toHaveURL(/#\/$/);
    await expect(searchInput(ready)).toHaveValue("Sample|test");
    await expect(fileCard(ready)).toBeVisible();
  });
});
