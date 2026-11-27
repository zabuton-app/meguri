import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath as ffmpeg } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  closeTopDialog,
  profileArg,
  skipFirstLaunchTour,
  waitForIdle,
} from "./fixtures/helpers";

// Each clip must show a picture, sound and advancing time in the detail view:
// ordinary videos (#299) and codecs Chromium cannot decode (#294).
const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
const CLIPS: Record<string, string[]> = {
  "H.264 AAC.mp4": [...H264, "-c:a", "aac"],
  "H.264 AAC.mkv": [...H264, "-c:a", "aac"],
  "MPEG-4 Part 2.avi": ["-c:v", "mpeg4", "-c:a", "libmp3lame"],
  "MJPEG.mov": ["-c:v", "mjpeg", "-c:a", "pcm_s16le"],
  "DTS.mkv": [...H264, "-c:a", "dca", "-strict", "-2"],
  "ALAC.mov": [...H264, "-c:a", "alac"],
  // The copy fails, so the server retries it as a preview.
  "VP8.mkv": ["-c:v", "libvpx", "-c:a", "libvorbis"],
};
// How the ordinary videos are served: the MP4 as it is, a Range request
// answered with 206, and the MKV as a remux streamed with 200.
const SERVED_WITH: Record<string, number> = {
  "H.264 AAC.mp4": 206,
  "H.264 AAC.mkv": 200,
};
// The exception: HEVC is served as it is, and Chromium on Linux has no decoder
// for it, so the player says the picture could not be decoded instead of
// playing sound over a black frame.
const NO_PICTURE: Record<string, string[]> =
  process.platform === "linux"
    ? { "HEVC.mp4": ["-c:v", "libx265", "-tag:v", "hvc1", "-c:a", "aac"] }
    : {};

test("plays ordinary videos and codecs Chromium cannot decode", async () => {
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-codecs-e2e-"));
  const media = path.join(tmp, "media");
  fs.mkdirSync(media);
  for (const [name, codecs] of Object.entries({ ...CLIPS, ...NO_PICTURE })) {
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
      args: [
        profileArg(path.join(tmp, "profile")),
        // A machine whose GPU decodes HEVC through VA-API would play it; the
        // check is about Chromium's own decoders.
        "--disable-accelerated-video-decode",
      ],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIdle(page);
    for (const name of Object.keys(CLIPS)) {
      await test.step(name, async () => {
        const served =
          name in SERVED_WITH
            ? page.waitForResponse(
                (response) =>
                  response.request().method() === "GET" &&
                  /\/media\/\d+/.test(response.url()),
              )
            : undefined;
        await page.getByTestId("media-card").filter({ hasText: name }).click();
        const player = page.locator("video");
        await expect(player).toBeVisible();
        if (served) expect((await served).status()).toBe(SERVED_WITH[name]);
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
              // A frame is there to show, not only the metadata.
              ready: video.readyState >= video.HAVE_CURRENT_DATA,
              picture: video.videoWidth > 0,
              video: counts.webkitVideoDecodedByteCount > 0,
              audio: counts.webkitAudioDecodedByteCount > 0,
              playing: video.currentTime > 0.5,
            };
          });
        await expect.poll(decoded, { timeout: 20_000 }).toEqual({
          error: null,
          ready: true,
          picture: true,
          video: true,
          audio: true,
          playing: true,
        });
        await closeTopDialog(page);
      });
    }
    for (const name of Object.keys(NO_PICTURE)) {
      await test.step(name, async () => {
        await page.getByTestId("media-card").filter({ hasText: name }).click();
        await expect(
          page.getByText("The picture could not be decoded", { exact: false }),
        ).toBeVisible({ timeout: 20_000 });
        await closeTopDialog(page);
      });
    }
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
