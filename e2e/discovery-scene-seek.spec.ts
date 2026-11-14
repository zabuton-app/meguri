import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath as ffmpeg } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  openDiscover,
  skipFirstLaunchTour,
  waitForIdle,
} from "./fixtures/helpers";

test("seeks from scenes inside the compact Discovery view and keeps play or pause", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-discovery-seek-"));
  const root = path.join(temp, "media");
  fs.mkdirSync(root);
  const name = "Scene seek fixture.mkv";
  execFileSync(ffmpeg!, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=duration=60:size=320x180:rate=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    path.join(root, name),
  ]);
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${path.join(temp, "profile")}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: root },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await expect(page.getByTitle(name, { exact: true }).first()).toBeVisible();
    // The scene rail needs the duration, which is probed after the row shows.
    await waitForIdle(page);
    const dialog = await openDiscover(page);
    const shrink = dialog.getByRole("button", { name: "Shrink modal" });
    if (await shrink.count()) await shrink.click();
    const enlarge = dialog.getByRole("button", { name: "Enlarge modal" });
    await expect(enlarge).toBeVisible();

    const scenes = dialog.getByRole("button", { name: /^Seek to / });
    const video = dialog.locator("video");
    const at = async () =>
      video.evaluate(
        (el: HTMLVideoElement) =>
          el.currentTime + Number(new URL(el.src).searchParams.get("t")),
      );
    const paused = () => video.evaluate((el: HTMLVideoElement) => el.paused);

    await scenes.first().click();
    await expect(page).toHaveURL(/#\/discover/);
    await expect(enlarge).toBeVisible();
    await expect.poll(at).toBeGreaterThanOrEqual(1.5);
    await expect.poll(paused).toBe(true);

    await dialog.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(paused).toBe(false);
    await scenes.nth(2).click();
    await expect(page).toHaveURL(/#\/discover/);
    await expect(enlarge).toBeVisible();
    await expect.poll(at).toBeGreaterThanOrEqual(11.5);
    await expect.poll(paused).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
