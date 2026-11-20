import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { fileCard, skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("filters visual media by resolution and recalls it from Smart collections", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-resolution-"));
  const media = path.join(temp, "media");
  fs.mkdirSync(media);
  for (const [name, size] of [
    ["portrait.png", "720x1280"],
    ["landscape.mp4", "1280x720"],
    ["larger.mp4", "1920x1080"],
  ]) {
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `color=c=blue:s=${size}`,
      "-frames:v",
      "1",
      path.join(media, name),
    ]);
  }
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${path.join(temp, "profile")}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await expect(fileCard(page, "portrait.png")).toBeVisible();
    await waitForIdle(page);
    await page
      .getByRole("radio", { name: "Video + Image", exact: true })
      .click();
    const resolution = page.getByRole("combobox", {
      name: "Resolution",
      exact: true,
    });
    await resolution.click();
    await page.getByRole("option", { name: "720p HD (1280 × 720)" }).click();
    await expect(fileCard(page, "larger.mp4")).toBeVisible();
    await page.getByRole("combobox", { name: "Resolution match" }).click();
    await page.getByRole("option", { name: "Exactly", exact: true }).click();
    await expect(fileCard(page, "larger.mp4")).toHaveCount(0);
    await expect(fileCard(page, "landscape.mp4")).toBeVisible();
    await expect(fileCard(page, "portrait.png")).toBeVisible();

    const collections = page.getByRole("button", { name: "Smart collections" });
    await collections.click();
    await page.getByText("Save current filters").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Collection name").fill("HD picks");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("radio", { name: "Audio", exact: true }).click();
    await expect(resolution).toHaveCount(0);
    await collections.click();
    await page.getByText("HD picks", { exact: true }).click();
    await expect(resolution).toHaveText("720p HD (1280 × 720)");
    await expect(fileCard(page, "larger.mp4")).toHaveCount(0);
    await expect(fileCard(page, "portrait.png")).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
