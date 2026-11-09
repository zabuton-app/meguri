import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  openSettings,
  openSettingsTab,
} from "./fixtures/helpers";

test.describe("Settings", () => {
  test("shows the same version and build in the sidebar and About", async ({
    ready,
  }) => {
    const readout = ready.locator('[data-slot="build-readout"]');
    await expect(readout).toBeVisible();
    await expect(readout).toHaveAttribute("title", /^v\S+ · Build [a-z0-9]+$/);
    const title = (await readout.getAttribute("title"))!;
    const [version, build] = title.slice(1).split(" · ");
    const dialog = await openSettingsTab(ready, "App");
    await expect(dialog.getByText(build, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(`巡 version ${version}`, { exact: true }),
    ).toBeVisible();
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

  test("opens from command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyK");
    await ready.getByText("Settings", { exact: true }).click();
    await expect(ready.getByText("Appearance")).toBeVisible();
  });
});
