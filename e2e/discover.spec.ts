import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  openDiscover,
  expectStarRating,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Discover", () => {
  test("opens from FAB and shows fixture media", async ({ ready }) => {
    const dialog = await openDiscover(ready);
    await expect(dialog.getByText(FIXTURE_FILE)).toBeVisible({
      timeout: 30_000,
    });
    await expect(dialog.getByText("1 / 1")).toBeVisible();
  });

  test("toggles favorite on discover card", async ({ ready }) => {
    const dialog = await openDiscover(ready);
    await expect(dialog.getByText(FIXTURE_FILE)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole("button", { name: "Add to favorites" }).click();
    await expect(
      dialog.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();
  });

  test("sets rating on discover card", async ({ ready }) => {
    const dialog = await openDiscover(ready);
    await expect(dialog.getByText(FIXTURE_FILE)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole("button", { name: "2 stars" }).click();
    await expectStarRating(dialog, 2);
  });

  test("opens detail from discover and returns on close", async ({ ready }) => {
    const dialog = await openDiscover(ready);
    await expect(dialog.getByText(FIXTURE_FILE)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole("link", { name: "Open" }).click();
    await expect(
      ready.getByRole("dialog").getByRole("heading", { name: FIXTURE_FILE }),
    ).toBeVisible();
    await ready.keyboard.press("Escape");
    await expect(
      ready.getByRole("dialog").getByText("Discovery", { exact: true }),
    ).toBeVisible();
  });

  test("closes with Escape", async ({ ready }) => {
    await openDiscover(ready);
    await closeTopDialog(ready);
    await expect(ready).toHaveURL(/#\/$/);
  });

  test("opens from command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyK");
    await ready.getByText("Discovery", { exact: true }).click();
    const dialog = ready.getByRole("dialog");
    await expect(dialog.getByText("Discovery", { exact: true })).toBeVisible();
    await expect(dialog.getByText(FIXTURE_FILE).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
