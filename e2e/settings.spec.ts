import { test, expect } from "./fixtures/app";
import { closeTopDialog, openSettings } from "./fixtures/helpers";

test.describe("Settings", () => {
  test("opens from sidebar and closes with Escape", async ({ ready }) => {
    await openSettings(ready);
    await closeTopDialog(ready);
    await expect(ready).toHaveURL(/#\/$/);
  });

  test("changes keybinding preset", async ({ ready }) => {
    const dialog = await openSettings(ready);
    await dialog.getByRole("combobox").nth(2).click();
    await ready.getByRole("option", { name: "Vim" }).click();
    await closeTopDialog(ready);
    await ready.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await closeTopDialog(ready);
  });

  test("opens from command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyK");
    await ready.getByText("Settings", { exact: true }).click();
    await expect(ready.getByText("Appearance")).toBeVisible();
  });
});
