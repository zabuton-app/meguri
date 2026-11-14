import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath as ffmpeg } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  closeTopDialog,
  skipFirstLaunchTour,
  waitForIdle,
} from "./fixtures/helpers";

// #294: codecs Chromium cannot decode play through a conversion. Each clip
// must show a picture, sound and advancing time in the detail view.
const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
const CLIPS: Record<string, string[]> = {
  "MPEG-4 Part 2.avi": ["-c:v", "mpeg4", "-c:a", "libmp3lame"],
  "MJPEG.mov": ["-c:v", "mjpeg", "-c:a", "pcm_s16le"],
  "DTS.mkv": [...H264, "-c:a", "dca", "-strict", "-2"],
  "ALAC.mov": [...H264, "-c:a", "alac"],
};

test("plays video and audio codecs Chromium cannot decode", async () => {
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-codecs-e2e-"));
  const media = path.join(tmp, "media");
  fs.mkdirSync(media);
  for (const [name, codecs] of Object.entries(CLIPS)) {
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24:duration=6",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=6",
      ...codecs,
      path.join(media, name),
    ]);
  }
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
    for (const name of Object.keys(CLIPS)) {
      await test.step(name, async () => {
        await page.getByTestId("media-card").filter({ hasText: name }).click();
        const player = page.locator("video");
        await expect(player).toBeVisible();
        await player.evaluate((video: HTMLVideoElement) => {
          if (video.paused) void video.play();
        });
        const decoded = () =>
          player.evaluate((video: HTMLVideoElement) => {
            const counts = video as unknown as {
              webkitVideoDecodedByteCount: number;
              webkitAudioDecodedByteCount: number;
            };
            return {
              error: video.error?.code ?? null,
              picture: video.videoWidth > 0,
              video: counts.webkitVideoDecodedByteCount > 0,
              audio: counts.webkitAudioDecodedByteCount > 0,
              playing: video.currentTime > 0.5,
            };
          });
        await expect.poll(decoded, { timeout: 20_000 }).toEqual({
          error: null,
          picture: true,
          video: true,
          audio: true,
          playing: true,
        });
        await closeTopDialog(page);
      });
    }
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
