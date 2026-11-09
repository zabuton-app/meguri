import { _electron, test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { fileCard, skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("always identifies location and bin, and carries bin rules between Global and remembered local folders", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-library-location-"),
  );
  const profile = path.join(temporary, "profile");
  const first = path.join(temporary, "Folder A");
  const child = path.join(first, "Day one");
  const second = path.join(temporary, "Folder B");
  for (const directory of [profile, child, second])
    fs.mkdirSync(directory, { recursive: true });
  const fixture = path.resolve("e2e/fixtures/media/test.png");
  fs.copyFileSync(fixture, path.join(first, "a-root.png"));
  fs.copyFileSync(fixture, path.join(child, "a-child.png"));
  fs.copyFileSync(fixture, path.join(second, "b-root.png"));
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({ roots: [first, second], activePath: first }),
  );
  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: [`--user-data-dir=${profile}`],
        env: { MEGURI_DISABLE_TRAY: "1" },
      }),
    );
  let app = await launch();
  let page: Page;
  const sidebar = () => page.getByRole("complementary", { name: "Smart bins" });
  const images = () =>
    sidebar()
      .getByRole("button", { name: /^Images/ })
      .first();
  const global = () =>
    sidebar().getByRole("button", { name: "Global", exact: true });
  const local = () =>
    sidebar().getByRole("button", { name: "Local", exact: true });
  const location = () => sidebar().locator('[data-slot="library-location"]');
  async function selectedLocation(name: string) {
    await expect(
      page
        .getByRole("navigation", { name: "Library navigation" })
        .getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await expect(sidebar().locator('[aria-current="true"]')).toHaveCount(1);
  }
  try {
    page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await expect(fileCard(page, "a-root.png")).toBeVisible();
    await waitForIdle(page);
    await expect(
      sidebar().getByRole("button", { name: "Browse without a smart bin" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(local()).toHaveAttribute("aria-pressed", "true");
    await selectedLocation("Folder A");
    await page
      .getByRole("button", { name: "Show by folder", exact: true })
      .click();
    await page
      .getByRole("button", { name: 'Open folder "Day one"', exact: true })
      .click();
    await expect(location()).toContainText("Day one");
    await page
      .getByRole("button", { name: "Create smart bin", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create smart bin",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Images");
    await editor.getByRole("radio", { name: "Image", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(images()).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await expect(fileCard(page, "a-child.png")).toBeVisible();
    await global().click();
    await expect(global()).toHaveAttribute("aria-pressed", "true");
    await expect(images()).toHaveAttribute("aria-current", "true");
    await selectedLocation("All");
    await expect(page.getByTestId("media-card")).toHaveCount(3);
    await local().click();
    await expect(location()).toContainText("Folder A / Day one");
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await selectedLocation("Folder A");
    await page.getByRole("button", { name: "Folder B", exact: true }).click();
    await expect(images()).toHaveAttribute("aria-current", "true");
    await expect(location()).toContainText("Folder B");
    await selectedLocation("Folder B");
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await expect(fileCard(page, "b-root.png")).toBeVisible();
    await global().click();
    await expect(page.getByTestId("media-card")).toHaveCount(3);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(global()).toHaveAttribute("aria-pressed", "true");
    await expect(images()).toHaveAttribute("aria-current", "true");
    await local().click();
    await expect(location()).toContainText("Folder B");
    await expect(fileCard(page, "b-root.png")).toBeVisible();
    await selectedLocation("Folder B");
    await sidebar()
      .getByRole("button", { name: "Browse without a smart bin", exact: true })
      .click();
    await expect(
      sidebar().getByRole("button", { name: "Browse without a smart bin" }),
    ).toHaveAttribute("aria-current", "true");
    await selectedLocation("Folder B");
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
