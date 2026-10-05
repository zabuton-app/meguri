import { test, expect } from "./fixtures/app";
import { closeTopDialog } from "./fixtures/helpers";

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
    await dialog.getByRole("tab", { name: /Suggestions/ }).click();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByText("✓ Applied")).toBeVisible();

    await dialog.getByRole("tab", { name: "Review by file" }).click();
    await expect(dialog.getByText("1 of 1 files reviewed")).toBeVisible();
    await dialog.getByRole("tab", { name: "Sort terms" }).click();

    // The tag is the user's own: the tag screen lists it like any other.
    await closeTopDialog(ready);
    await ready.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(
      ready.getByRole("dialog").getByText("Test", { exact: true }),
    ).toBeVisible();
    await closeTopDialog(ready);

    // The configuration was saved as it was edited, and the suggestion now
    // reads as settled because the file carries the tag.
    await ready.getByRole("link", { name: "Auto tagging" }).click();
    await dialog.getByRole("tab", { name: /Suggestions/ }).click();
    await expect(dialog.getByText("✓ Applied")).toBeVisible();
  });
});
