import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  openCommandMenu,
  searchTrigger,
  FIXTURE_FILE,
} from "./fixtures/helpers";

test.describe("Navigation", () => {
  test("opens command menu with Ctrl+K", async ({ ready }) => {
    await openCommandMenu(ready);
    await expect(ready.getByText("List view")).toBeVisible();
    await expect(ready.getByText("Discovery")).toBeVisible();
  });

  test("the search in the title bar opens the command menu over it", async ({
    ready,
  }) => {
    const trigger = searchTrigger(ready);
    const at = await trigger.boundingBox();
    await trigger
      .getByRole("button", { name: "Search or run a command" })
      .click();
    const input = ready.getByPlaceholder("Search files, or type a command...");
    await expect(input).toBeFocused();
    // As in VS Code: the menu's field lies where the search was, so one field
    // is on screen, with the commands under it.
    const field = await input.boundingBox();
    if (!at || !field) throw new Error("no layout box");
    expect(
      Math.abs(field.y + field.height / 2 - (at.y + at.height / 2)),
    ).toBeLessThan(4);
    expect(Math.abs(field.x - at.x)).toBeLessThan(at.width);
  });

  test("the search shortcut opens the command menu", async ({ ready }) => {
    await ready.keyboard.press("Control+KeyF");
    await expect(
      ready.getByPlaceholder("Search files, or type a command..."),
    ).toBeFocused();
  });

  test("command menu switches to list view", async ({ ready }) => {
    await openCommandMenu(ready);
    await ready.getByText("List view", { exact: true }).click();
    await expect(
      ready.getByRole("button", { name: "List view", pressed: true }),
    ).toBeVisible();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("command menu keeps typing through a prefix", async ({ ready }) => {
    await openCommandMenu(ready);
    // The prefix swaps the field for its page's; the keys after it must land
    // in the new one.
    await ready.keyboard.type("ws:al");
    const field = ready.getByPlaceholder("Switch to a workspace...");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("al");
    await ready.keyboard.press("Backspace");
    await ready.keyboard.press("Backspace");
    await ready.keyboard.press("Backspace");
    await expect(
      ready.getByPlaceholder("Search files, or type a command..."),
    ).toBeFocused();
  });

  test("command menu searches in a workspace picked with ws:", async ({
    ready,
  }) => {
    await openCommandMenu(ready);
    await ready.keyboard.type("ws:");
    await expect(ready.getByText("Current")).toBeVisible();
    // The first row is All; Enter picks it, then a search is typed for it.
    await ready.keyboard.press("Enter");
    await ready.keyboard.type("zzqx");
    await ready.keyboard.press("Enter");
    await expect(
      ready.getByPlaceholder("Search files, or type a command..."),
    ).toHaveCount(0);
    await expect(searchTrigger(ready)).toContainText("zzqx");
  });

  test("opens keyboard shortcuts overlay", async ({ ready }) => {
    await ready.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await expect(
      ready.getByRole("heading", { level: 3, name: /^Player/ }),
    ).toBeVisible();
    await closeTopDialog(ready);
    await expect(ready.getByText("Keyboard shortcuts")).toHaveCount(0);
  });

  test("opens shortcuts overlay with question mark", async ({ ready }) => {
    await ready.keyboard.press("Shift+Slash");
    await expect(ready.getByText("Keyboard shortcuts")).toBeVisible();
    await closeTopDialog(ready);
  });
});
