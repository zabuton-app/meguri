import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("plays and seeks an indexed ProRes 422 MOV in the full player", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-prores-e2e-"));
  const media = path.join(tmp, "media");
  fs.mkdirSync(media);
  const clip = path.join(media, "ProRes 422.mov");
  execFileSync(ffmpeg!, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24:duration=8",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=8",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "standard",
    "-pix_fmt",
    "yuv422p10le",
    "-c:a",
    "pcm_s16le",
    clip,
  ]);
  const original = fs.readFileSync(clip);
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
    await page
      .getByTestId("media-card")
      .filter({ hasText: "ProRes 422" })
      .click();
    const player = page.locator("video");
    await expect(player).toBeVisible();
    if (await player.evaluate((video: HTMLVideoElement) => video.paused)) {
      await page
        .getByRole("button", { name: "Play", exact: true })
        .first()
        .click();
    }
    const playbackTime = () =>
      player.evaluate((video: HTMLVideoElement) => {
        const start = Number(new URL(video.currentSrc).searchParams.get("t"));
        return start + video.currentTime;
      });
    await expect.poll(playbackTime).toBeGreaterThan(0.15);
    await page.getByTitle("Seek to 0:05", { exact: true }).first().click();
    await expect.poll(playbackTime).toBeGreaterThan(4.8);
    await page.getByTitle("Seek to 0:01", { exact: true }).first().click();
    await expect.poll(playbackTime).toBeLessThan(3);
    await expect(player).toHaveJSProperty("error", null);
    expect(fs.readFileSync(clip)).toEqual(original);
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
