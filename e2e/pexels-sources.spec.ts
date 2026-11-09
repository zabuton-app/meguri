import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("reviews folder and selected Pexels links and can edit and remove a saved source", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-pexels-e2e-"));
  const media = path.join(tmp, "media");
  const batch = path.join(media, "Stock");
  fs.mkdirSync(batch, { recursive: true });
  const suggested = "5586539-hd_1920_1080_30fps.mp4";
  for (const [name, color] of [
    [suggested, "blue"],
    ["Renamed clip.mp4", "red"],
  ]) {
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `color=${color}:s=320x180:r=3:d=2`,
      "-c:v",
      "libx264",
      path.join(batch, name),
    ]);
  }
  const original = fs.readFileSync(path.join(batch, suggested));
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${path.join(tmp, "profile")}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIdle(page);
    const folderView = page.getByRole("button", {
      name: "Show by folder",
      exact: true,
    });
    if ((await folderView.getAttribute("aria-pressed")) === "false")
      await folderView.click();
    await page.getByTestId("folder-card").filter({ hasText: "Stock" }).click();
    const review = page.getByRole("dialog", { name: "Recover source links" });
    await page.getByRole("button", { name: "Recover folder links" }).click();
    await expect(review.getByRole("article")).toHaveCount(2);
    const proposed = review
      .getByRole("article")
      .filter({ hasText: "Pexels 5586539" });
    const local = proposed.getByRole("img", { name: "Library clip" });
    await expect(local).not.toHaveJSProperty("naturalWidth", 0);
    await expect(proposed.getByText(/320 × 180/)).toBeVisible();
    await expect(proposed.getByText("MP4", { exact: true })).toBeVisible();
    await proposed.getByRole("checkbox").check();
    await review
      .getByRole("button", { name: "Save links (1)", exact: true })
      .click();
    await expect(
      proposed.getByText("Source already saved · Pexels 5586539"),
    ).toBeVisible();
    await review
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close" })
      .click();

    const card = page.getByTestId("media-card").filter({ hasText: "5586539" });
    await card.hover();
    await card.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Recover selected links" }).click();
    await expect(review.getByRole("article")).toHaveCount(1);
    await review.getByRole("button", { name: "Edit source" }).click();
    const url = review.getByRole("textbox", { name: "Pexels video URL" });
    await url.fill("https://www.pexels.com/video/2499611/?ref=share");
    await review
      .getByRole("button", { name: "Save this link", exact: true })
      .click();
    await expect(
      review.getByText("Source already saved · Pexels 2499611"),
    ).toBeVisible();
    await review.getByRole("button", { name: "Remove source" }).click();
    await expect(
      review.getByText("Suggested from filename · Pexels 5586539"),
    ).toBeVisible();
    await review
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page
      .getByPlaceholder("Search file name or tags")
      .fill("Renamed clip");
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Recover matching links" }).click();
    await expect(review.getByRole("article")).toHaveCount(1);
    await expect(review.getByRole("article")).toContainText("Renamed clip");
    expect(fs.readFileSync(path.join(batch, suggested))).toEqual(original);
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
