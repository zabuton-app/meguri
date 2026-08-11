import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  openFileDetail,
  expectStarRating,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Media detail", () => {
  test("opens image detail from grid", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    await expect(dialog.getByText("Tags", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Rating", { exact: true })).toBeVisible();
  });

  test("closes detail with Escape", async ({ ready }) => {
    await openFileDetail(ready);
    await closeTopDialog(ready);
    await expect(ready).toHaveURL(/#\/$/);
  });

  test("toggles favorite in detail", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    await dialog.getByRole("button", { name: "Add to favorites" }).click();
    await expect(
      dialog.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();
  });

  test("sets rating in detail", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    await dialog.getByRole("button", { name: "5 stars" }).click();
    await expectStarRating(dialog, 5);
  });

  test("adds and removes a manual tag", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    const tagInput = dialog.getByPlaceholder("Add a tag and press Enter");
    await tagInput.fill("e2e-tag");
    await tagInput.press("Enter");
    await expect(dialog.getByText("e2e-tag")).toBeVisible();

    await dialog.getByRole("button", { name: "Remove tag" }).click();
    await expect(dialog.getByText("e2e-tag")).toHaveCount(0);
    // Not "No tags" any more: the scan classifies the fixture and the detail
    // view is where those generated tags are shown, so the list is never empty.
    await expect(
      dialog.getByText("res:", { exact: false }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("inverts image background", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    const invert = dialog.getByRole("button", {
      name: "Invert image background",
    });
    await invert.click();
    await expect(invert).toHaveAttribute("aria-pressed", "true");
    await invert.click();
    await expect(invert).toHaveAttribute("aria-pressed", "false");
  });

  test("opens more actions menu", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    await dialog.getByRole("button", { name: "More actions" }).click();
    await expect(
      ready.getByRole("menuitem", { name: "Copy File Path" }),
    ).toBeVisible();
    await expect(
      ready.getByRole("menuitem", { name: "Open containing folder" }),
    ).toBeVisible();
    await expect(
      ready.getByRole("menuitem", { name: "Delete From Index" }),
    ).toBeVisible();
  });

  test("list stays mounted under detail modal", async ({ ready }) => {
    await openFileDetail(ready);
    await expect(ready.locator("#list-search-input")).toBeVisible();
    await expect(
      ready.getByRole("contentinfo", { name: "Status bar" }),
    ).toBeVisible();
  });

  test("opens detail paused from metadata link", async ({ ready }) => {
    const metaLink = ready.locator('a[href*="autoplay=0"]');
    await expect(metaLink).toBeVisible();
    // The link wraps rating buttons; click the filename text, not the star controls.
    await metaLink.getByText(FIXTURE_FILE, { exact: true }).click();
    await expect(ready.getByRole("dialog")).toBeVisible();
    await expect(ready).toHaveURL(/autoplay=0/);
  });
});
