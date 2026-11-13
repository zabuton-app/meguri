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
    await dialog
      .locator("section", { hasText: "Keybinds" })
      .getByRole("combobox")
      .click();
    await ready.getByRole("option", { name: "Vim" }).click();
    await closeTopDialog(ready);
    await ready.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await closeTopDialog(ready);
  });

  // The Japanese description is the longest beside the picker, and the minimum
  // window size leaves the row the least room (#409).
  test("keeps the logo previews square in a narrow window", async ({
    app,
    ready,
  }) => {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [width, height] = win.getMinimumSize();
      win.setSize(width, height);
    });
    // The resize lands asynchronously; measuring before it would pass at any width.
    await expect
      .poll(() => ready.evaluate(() => window.innerWidth))
      .toBeLessThanOrEqual(640);
    const dialog = await openSettings(ready);
    await dialog
      .locator("section", { hasText: "Language" })
      .getByRole("combobox")
      .click();
    await ready.getByRole("option", { name: "日本語" }).click();

    const previews = dialog
      .locator("section", { hasText: "アプリのロゴ" })
      .locator("img");
    await expect(previews).toHaveCount(3);
    for (const preview of await previews.all()) {
      const box = await preview.boundingBox();
      expect(box?.width).toBe(48);
      expect(box?.height).toBe(48);
    }
  });

  test("opens from command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyK");
    await ready.getByText("Settings", { exact: true }).click();
    await expect(ready.getByText("Appearance")).toBeVisible();
  });
});
