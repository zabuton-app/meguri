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
    await dialog.getByRole("tab", { name: "Keywords" }).click();
    const add = dialog.getByLabel(/Add a keyword/);
    await add.fill("Test");
    await add.press("Enter");
    await expect(dialog.getByText("Terms to find")).toBeVisible();
    await expect(dialog.getByText("Matching files")).toBeVisible();

    // A keyword is not a suggestion: it is applied over the library as a
    // whole, after a question, and tags the file for real.
    await dialog
      .getByRole("button", { name: "Apply to existing files" })
      .click();
    await ready
      .getByRole("alertdialog")
      .getByRole("button", { name: "Apply to existing files" })
      .click();
    await expect(dialog.getByText("Added 1 tags to 1 files")).toBeVisible();

    // The tag is the user's own: the tag screen lists it like any other.
    await closeTopDialog(ready);
    await ready.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(
      ready.getByRole("dialog").getByText("Test", { exact: true }),
    ).toBeVisible();
  });

  test("searches the library for a keyword's terms", async ({ ready }) => {
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    const dialog = ready.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Keywords" }).click();
    const add = dialog.getByLabel(/Add a keyword/);
    // The second term matches the fixture ("test.png"); the first does not.
    await add.fill("Sample, test");
    await add.press("Enter");
    await dialog.getByRole("button", { name: "Search the library" }).click();

    await expect(ready).toHaveURL(/#\/$/);
    await expect(searchInput(ready)).toHaveValue("Sample|test");
    await expect(fileCard(ready)).toBeVisible();
  });
});
