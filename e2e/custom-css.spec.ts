import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openSettings } from "./fixtures/helpers";

// The real cascade and the real watcher: a jsdom test can show the <style>
// element's text, not that the rule beats the theme's html[data-theme] block.
const primary = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--c-primary")
      .trim(),
  );

// The data-slot hooks documented for custom.css (the list in docs/theming.md
// is the source of truth). User stylesheets target them, so renaming or
// dropping one breaks theirs. folder-card / folder-row and
// audio-player-bar need a folder view or playback to appear and are not
// covered here.
const SHELL_SLOTS = [
  "workspace-rail",
  "home-header",
  "filter-bar",
  "status-bar",
];

test.describe("Custom CSS", () => {
  test("keeps the documented data-slot hooks in place", async ({ ready }) => {
    for (const slot of SHELL_SLOTS) {
      await expect(ready.locator(`[data-slot="${slot}"]`)).toHaveCount(1);
    }

    await ready.getByRole("button", { name: "Grid view" }).click();
    await expect(
      ready.locator('[data-slot="media-card"]').first(),
    ).toBeVisible();
    await ready.getByRole("button", { name: "List view" }).click();
    await expect(
      ready.locator('[data-slot="media-row"]').first(),
    ).toBeVisible();

    await openSettings(ready);
    await expect(ready.locator('[data-slot="modal-panel"]')).toBeVisible();
  });

  test("applies custom.css over the theme while switched on", async ({
    app,
    ready,
  }) => {
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    const file = path.join(userData, "custom.css");
    const themePrimary = await primary(ready);

    const dialog = await openSettings(ready);
    const toggle = dialog
      .locator("section", { hasText: "Custom CSS" })
      .getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Off: a file on disk is not applied.
    fs.writeFileSync(file, "html[data-theme] { --c-primary: #010203; }");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => primary(ready)).toBe("#010203");

    // Saved while on: applied without touching the switch.
    fs.writeFileSync(file, "html[data-theme] { --c-primary: #040506; }");
    await expect.poll(() => primary(ready)).toBe("#040506");

    // Off again: back to the theme.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => primary(ready)).toBe(themePrimary);
  });

  test("the sample theme follows the light / dark switch", async ({
    app,
    ready,
  }) => {
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    fs.copyFileSync(
      path.join(process.cwd(), "docs/themes/cyberpunk.css"),
      path.join(userData, "custom.css"),
    );
    const bg = () =>
      ready.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--c-bg")
          .trim(),
      );
    const root = ready.locator("html");

    const dialog = await openSettings(ready);
    await dialog
      .locator("section", { hasText: "Custom CSS" })
      .getByRole("switch")
      .click();

    // Scoped: the logo picker has a "Dark" button too.
    const appearance = dialog.locator("section", { hasText: "Appearance" });
    await appearance.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(root).toHaveAttribute("data-appearance", "dark");
    await expect.poll(bg).toBe("#0a0a14");

    await appearance
      .getByRole("button", { name: "Light", exact: true })
      .click();
    await expect(root).toHaveAttribute("data-appearance", "light");
    await expect.poll(bg).toBe("#f5f2ff");
  });

  test("applies a picked theme file under custom.css", async ({
    app,
    ready,
  }) => {
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    const themes = path.join(userData, "themes");
    fs.mkdirSync(themes, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "docs/themes/cyberpunk.css"),
      path.join(themes, "cyberpunk.css"),
    );
    const bg = () =>
      ready.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--c-bg")
          .trim(),
      );
    const themeBg = await bg();

    const dialog = await openSettings(ready);
    const picker = dialog
      .locator("section", { hasText: "CSS theme" })
      .getByRole("combobox");
    // The file was added after launch: it reaches the list through the watch.
    await expect(async () => {
      await picker.click();
      await ready.getByRole("option", { name: "Cyberpunk" }).click();
    }).toPass({ timeout: 5000 });
    await expect.poll(bg).toBe("#0a0a14");

    // custom.css sits on top of the theme at equal specificity.
    fs.writeFileSync(
      path.join(userData, "custom.css"),
      'html[data-appearance="dark"] { --c-bg: #123456; }',
    );
    await dialog
      .locator("section", { hasText: "Custom CSS" })
      .getByRole("switch")
      .click();
    await expect.poll(bg).toBe("#123456");

    await dialog
      .locator("section", { hasText: "Custom CSS" })
      .getByRole("switch")
      .click();
    await picker.click();
    await ready.getByRole("option", { name: "None" }).click();
    await expect.poll(bg).toBe(themeBg);
  });
});
