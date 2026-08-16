// Selection is opt-in app-wide (body { user-select: none } in src/styles.css)
// plus a Ctrl/Cmd+A guard (src/hooks/useSelectAllGuard.ts). Neither is
// observable in jsdom — computed user-select and real selection behaviour only
// exist in a browser — so the contract is pinned here.
import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import {
  openFileDetail,
  openSettings,
  searchInput,
  waitForIndexedMedia,
  FIXTURE_FILE,
} from "./fixtures/helpers";

/** Whatever is currently selected, as plain text. */
function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

test.describe("Text selection", () => {
  test("Ctrl+A selects nothing on the list screen", async ({ ready }) => {
    await waitForIndexedMedia(ready);
    await ready.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await ready.keyboard.press("Control+KeyA");
    expect(await selectedText(ready)).toBe("");
  });

  test("Ctrl+A selects nothing even where regions opt in", async ({
    ready,
  }) => {
    // The list screen has no `select-text` at all, so the CSS alone would pass
    // it. Settings carries two opted-in sections: without the guard, Ctrl+A
    // grabs both at once — which is the whole-window highlight being avoided.
    await openSettings(ready);
    await ready.keyboard.press("Control+KeyA");
    expect(await selectedText(ready)).toBe("");
  });

  test("dragging over the list selects nothing", async ({ ready }) => {
    await waitForIndexedMedia(ready);
    const name = ready.getByText(FIXTURE_FILE).first();
    await expect(name).toHaveCSS("user-select", "none");
    const box = await name.boundingBox();
    if (!box) throw new Error("file name has no layout box");
    const y = box.y + box.height / 2;
    await ready.mouse.move(box.x + 2, y);
    await ready.mouse.down();
    await ready.mouse.move(box.x + box.width - 2, y, { steps: 10 });
    await ready.mouse.up();
    expect(await selectedText(ready)).toBe("");
  });

  test("Ctrl+A still selects all inside the search field", async ({
    ready,
  }) => {
    const search = searchInput(ready);
    await search.fill("hello");
    await search.press("Control+KeyA");
    const [start, end] = await search.evaluate((el) => [
      (el as HTMLInputElement).selectionStart,
      (el as HTMLInputElement).selectionEnd,
    ]);
    expect(start).toBe(0);
    expect(end).toBe("hello".length);
  });

  test("the detail title and folder stay selectable", async ({ ready }) => {
    const dialog = await openFileDetail(ready);
    const heading = dialog.getByRole("heading", { name: FIXTURE_FILE });
    await expect(heading).toHaveCSS("user-select", "text");
    await heading.click({ clickCount: 3 });
    expect(await selectedText(ready)).toContain(FIXTURE_FILE);
  });

  test("the About section stays selectable", async ({ ready }) => {
    const dialog = await openSettings(ready);
    const version = dialog.getByText(/^Meguri Version /);
    await expect(version).toHaveCSS("user-select", "text");
    await version.click({ clickCount: 3 });
    expect(await selectedText(ready)).toContain("Meguri Version");
  });

  test("error toasts stay selectable", async ({ ready }) => {
    await waitForIndexedMedia(ready);
    // The first Escape on the bare list only arms the close and shows a hint
    // toast; a second one would close the window, so press it exactly once.
    await ready.keyboard.press("Escape");
    const toast = ready.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS("user-select", "text");
    // Sonner captures the pointer for swipe-to-dismiss, so a drag selects
    // nothing here; triple-click is the gesture that works.
    await toast.click({ clickCount: 3 });
    expect(await selectedText(ready)).not.toBe("");
  });
});
