import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath as ffmpeg } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { openFileDetail, skipFirstLaunchTour } from "./fixtures/helpers";

test("video adjustments sit above a full-width scene strip", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-adjustments-"));
  const media = path.join(tmp, "media");
  fs.mkdirSync(media);
  const name = "Widescreen sample.mp4";
  execFileSync(ffmpeg!, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x270:rate=12:duration=8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(media, name),
  ]);
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${path.join(tmp, "profile")}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    const detail = await openFileDetail(page, name);
    const scenes = detail.locator("section").filter({
      has: page.getByRole("heading", { name: "Scenes", exact: true }),
    });
    await expect(scenes).toBeVisible();
    const closed = (await scenes.boundingBox())!;

    await detail.getByRole("button", { name: "Video adjustments" }).click();
    const panel = detail.getByRole("complementary", {
      name: "Video adjustments",
    });
    await expect(panel.getByRole("slider", { name: "Tint" })).toBeVisible();
    const opened = (await scenes.boundingBox())!;
    const controls = (await panel.boundingBox())!;
    const picture = (await detail.locator("video").boundingBox())!;

    expect(picture.x + picture.width).toBeLessThanOrEqual(controls.x);
    // A sidebar beside the video, at least as tall as the picture. On a wide
    // clip it keeps the height its controls need, so none is scrolled away.
    expect(Math.abs(controls.y - picture.y)).toBeLessThanOrEqual(1);
    expect(controls.height).toBeGreaterThan(picture.height);
    const tint = (await panel
      .getByRole("slider", { name: "Tint" })
      .boundingBox())!;
    expect(tint.y + tint.height).toBeLessThanOrEqual(
      controls.y + controls.height,
    );
    expect(controls.y + controls.height).toBeLessThan(opened.y);
    expect(opened.width).toBeCloseTo(closed.width, 0);
    expect(opened.x + opened.width).toBeGreaterThanOrEqual(
      controls.x + controls.width - 1,
    );
  } finally {
    try {
      await app.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});
