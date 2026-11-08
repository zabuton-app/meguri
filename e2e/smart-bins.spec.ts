import { _electron, test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { fileCard, skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("global smart bins retain scope, resolution, type and ratings after restart", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-smart-bins-"),
  );
  const profile = path.join(temporary, "profile");
  const first = path.join(temporary, "Pexels A");
  const second = path.join(temporary, "Pexels B");
  for (const directory of [profile, first, second]) fs.mkdirSync(directory);
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({
      roots: [first, second],
      activePath: first,
    }),
  );
  function media(destination: string, size: string) {
    execFileSync(ffmpeg!, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=" + size + ":r=1",
      "-frames:v",
      "1",
      destination,
    ]);
  }
  media(path.join(first, "clip-hd.mp4"), "1280x720");
  media(path.join(first, "photo-4k.png"), "3840x2160");
  media(path.join(second, "clip-4k.mp4"), "3840x2160");

  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: ["--user-data-dir=" + profile],
        env: { MEGURI_DISABLE_TRAY: "1" },
      }),
    );
  let app = await launch();
  try {
    let page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await skipFirstLaunchTour(page);
    await expect(page.getByText("clip-hd.mp4", { exact: true })).toBeVisible();
    await waitForIdle(page);
    for (const name of ["clip-hd.mp4", "photo-4k.png"]) {
      await fileCard(page, name)
        .getByRole("button", { name: "4 stars", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Pexels B", exact: true }).click();
    await expect(page.getByText("clip-4k.mp4", { exact: true })).toBeVisible();
    await waitForIdle(page);
    await fileCard(page, "clip-4k.mp4")
      .getByRole("button", { name: "5 stars", exact: true })
      .click();
    await page.getByRole("button", { name: "Pexels A", exact: true }).click();

    await page
      .getByRole("button", { name: "Create smart bin", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("4K picks");
    await dialog
      .getByRole("radio", { name: "Video + Image", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Resolution", exact: true })
      .click();
    await page
      .getByRole("option", { name: "4K UHD (3840 × 2160)", exact: true })
      .click();
    await dialog.getByRole("button", { name: "4 stars", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    const sidebar = page.getByRole("complementary", { name: "Smart bins" });
    await expect(
      sidebar.getByRole("button", { name: "4K picks", exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("media-card")).toHaveCount(2);
    await expect(fileCard(page, "photo-4k.png")).toBeVisible();
    await expect(fileCard(page, "clip-4k.mp4")).toBeVisible();

    await page.getByRole("button", { name: "Pexels A", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await sidebar
      .getByRole("button", { name: "4K picks", exact: false })
      .first()
      .click();
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    await sidebar
      .getByRole("button", { name: "Edit smart bin: 4K picks", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("4K video");
    await dialog.getByRole("radio", { name: "Video", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await expect(fileCard(page, "clip-4k.mp4")).toBeVisible();

    await page
      .getByRole("button", { name: "Create smart bin", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("720p picks");
    await dialog
      .getByRole("combobox", { name: "Resolution", exact: true })
      .click();
    await page
      .getByRole("option", { name: "720p HD (1280 × 720)", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Resolution match", exact: true })
      .click();
    await page.getByRole("option", { name: "Exactly", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(fileCard(page, "clip-hd.mp4")).toBeVisible();

    await page
      .getByRole("button", { name: "Smart collections", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Set as default: 4K video", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Pexels A", exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const restored = page.getByRole("complementary", { name: "Smart bins" });
    // The default restores its global scope even though a scanned folder was
    // selected when the app closed.
    await expect(fileCard(page, "clip-4k.mp4")).toBeVisible();
    await restored
      .getByRole("button", { name: "4K video", exact: false })
      .first()
      .click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await expect(fileCard(page, "clip-4k.mp4")).toBeVisible();
    await expect(
      restored
        .getByRole("button", { name: "720p picks", exact: false })
        .first(),
    ).toBeVisible();
    await restored
      .getByRole("button", {
        name: "Delete smart bin: 720p picks",
        exact: true,
      })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete smart bin", exact: true })
      .click();
    await expect(
      restored.getByRole("button", { name: "720p picks", exact: false }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
