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
    await expect(ready.getByPlaceholder("Search commands...")).toBeFocused();
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
    await expect(ready.getByPlaceholder("Search commands...")).toHaveCount(0);
    await expect(searchInput(ready)).toHaveValue("zzqx");
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
