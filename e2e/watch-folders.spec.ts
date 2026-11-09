import { _electron, test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { fileCard, skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("watches real downloads globally and per folder, and remembers new-file choices and watch settings", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-watch-e2e-"));
  const profile = path.join(temporary, "profile");
  const first = path.join(temporary, "Downloads A");
  const second = path.join(temporary, "Downloads B");
  for (const directory of [profile, first, second]) fs.mkdirSync(directory);
  // Write new files so the test sees fresh birthtimes on filesystems that
  // preserve creation dates when copying a file.
  const fixture = fs.readFileSync(path.resolve("e2e/fixtures/media/test.png"));
  fs.writeFileSync(path.join(first, "baseline-a.png"), fixture);
  fs.writeFileSync(path.join(second, "baseline-b.png"), fixture);
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({ roots: [first, second], activePath: "__all__" }),
  );
  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: ["--user-data-dir=" + profile],
        env: { MEGURI_DISABLE_TRAY: "1" },
      }),
    );
  let app = await launch();
  let page: Page;
  const recentPanel = () =>
    page.getByRole("dialog", { name: "New files", exact: true });
  const watchPanel = () =>
    page.getByRole("dialog", { name: "Watch folders", exact: true });
  async function openRecent() {
    await page.getByRole("button", { name: /^New files/ }).click();
  }
  async function choose(name: string, option: string) {
    await recentPanel().getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  try {
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await skipFirstLaunchTour(page);
    await expect(page.getByTestId("media-card")).toHaveCount(2);
    await waitForIdle(page);

    fs.writeFileSync(path.join(first, "download-a.png"), fixture);
    fs.writeFileSync(path.join(second, "download-b.png"), fixture);
    fs.mkdirSync(path.join(first, "batch"));
    fs.writeFileSync(path.join(first, "batch", "nested.png"), fixture);
    await expect(fileCard(page, "download-a.png")).toBeVisible({
      timeout: 15000,
    });
    await expect(fileCard(page, "download-b.png")).toBeVisible({
      timeout: 15000,
    });
    await expect(fileCard(page, "nested.png")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("media-card")).toHaveCount(5);
    await waitForIdle(page);

    await page
      .getByRole("button", { name: "Downloads A", exact: true })
      .click();
    await openRecent();
    await expect(
      recentPanel().getByRole("combobox", { name: "Define new using" }),
    ).toHaveText("First discovered by Meguri");
    await choose("Time window", "Today");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("media-card")).toHaveCount(3);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(5);
    await openRecent();
    await choose("Time window", "Last hour");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Create smart bin", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create smart bin",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("New downloads");
    await editor.getByRole("button", { name: "Save", exact: true }).click();

    await openRecent();
    await choose("Define new using", "File creation date");
    await choose("Time window", "Last 24 hours");
    await page.keyboard.press("Escape");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await openRecent();
    await expect(
      recentPanel().getByRole("combobox", { name: "Define new using" }),
    ).toHaveText("File creation date");
    await expect(
      recentPanel().getByRole("combobox", { name: "Time window" }),
    ).toHaveText("Last 24 hours");
    await page.keyboard.press("Escape");
    await page
      .getByRole("complementary", { name: "Smart bins" })
      .getByRole("button", { name: /^New downloads/ })
      .first()
      .click();
    await expect(page.getByTestId("media-card")).toHaveCount(5);
    // Selecting the bin retains the visitor window instead of replacing it
    // with the bin's own Last hour / discovery rule.
    await openRecent();
    await expect(
      recentPanel().getByRole("combobox", { name: "Define new using" }),
    ).toHaveText("File creation date");
    await expect(
      recentPanel().getByRole("combobox", { name: "Time window" }),
    ).toHaveText("Last 24 hours");
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: "Watch folders", exact: true })
      .click();
    const watching = watchPanel().getByRole("checkbox", {
      name: "Automatically watch scanned folders",
      exact: true,
    });
    await expect(watching).toBeChecked();
    await watching.click();
    await expect(watching).not.toBeChecked();
    await page.keyboard.press("Escape");
    // A workspace write must not restore a stale copy of the watch setting.
    await page
      .getByRole("button", { name: "Downloads A", exact: true })
      .click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Watch folders", exact: true })
      .click();
    await expect(watchPanel().getByRole("checkbox")).not.toBeChecked();
    await page.keyboard.press("Escape");
    await waitForIdle(page);
    fs.writeFileSync(path.join(first, "manual.png"), fixture);
    await page
      .getByRole("button", { name: "Scan", exact: true })
      .first()
      .click();
    await expect(fileCard(page, "manual.png")).toBeVisible({ timeout: 15000 });
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
