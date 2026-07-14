import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  openCommandMenu,
  searchInput,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Navigation", () => {
  test("opens command menu with Ctrl+K", async ({ ready }) => {
    await openCommandMenu(ready);
    await expect(ready.getByText("Focus search")).toBeVisible();
    await expect(ready.getByText("Discovery")).toBeVisible();
  });

  test("command menu focuses search", async ({ ready }) => {
    await openCommandMenu(ready);
    await ready.getByText("Focus search", { exact: true }).click();
    await expect(searchInput(ready)).toBeFocused();
  });

  test("command menu switches to list view", async ({ ready }) => {
    await openCommandMenu(ready);
    await ready.getByText("List view", { exact: true }).click();
    await expect(
      ready.getByRole("button", { name: "List view", pressed: true }),
    ).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("opens keyboard shortcuts overlay", async ({ ready }) => {
    await ready.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await expect(ready.getByText("Detail & player")).toBeVisible();
    await closeTopDialog(ready);
    await expect(ready.getByText("Keyboard shortcuts")).toHaveCount(0);
  });

  test("opens shortcuts overlay with question mark", async ({ ready }) => {
    await ready.keyboard.press("Shift+Slash");
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await closeTopDialog(ready);
  });
});
