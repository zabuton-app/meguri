import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  openFileDetail,
  skipFirstLaunchTour,
  waitForIdle,
  waitForIndexedMedia,
} from "./fixtures/helpers";

test("video adjustments stay clickable under a stationary pointer", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-adjustments-"));
  const root = path.join(temp, "media");
  fs.mkdirSync(root);
  const name = "Adjustments sample.mp4";
  execFileSync(ffmpegPath!, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=12:duration=15",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
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
    await waitForIndexedMedia(page, name);
    await waitForIdle(page);
    const dialog = await openFileDetail(page, name);
    const video = dialog.locator("video");
    const trigger = dialog.getByRole("button", {
      name: "Video adjustments",
      exact: true,
    });
    await video.evaluate((element) => (element as HTMLVideoElement).play());
    await page.mouse.move(2, 2);
    await expect(trigger).toHaveCSS("opacity", "0");

    await video.hover({ position: { x: 25, y: 25 } });
    await expect(trigger).toHaveCSS("opacity", "1");
    await trigger.hover(); console.log("BOX1", JSON.stringify(await trigger.boundingBox()));
    const hoveredAt = await video.evaluate(
      (element) => (element as HTMLVideoElement).currentTime,
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("update:available", { current: "0.0", latest: "0.12.0", available: true, url: "https://github.com/zabuton-app/meguri/releases/tag/v0.12.0", name: "v0.12.0", publishedAt: null }));
    // The former idle timer hid the control after 1.8 seconds under the pointer.
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(hoveredAt + 2);
    await expect(trigger).toHaveCSS("opacity", "1");
    await expect(trigger).toHaveCSS("pointer-events", "auto");
    console.log("BOX2", JSON.stringify(await trigger.boundingBox()), await trigger.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 80); }));
    await page.evaluate(() => { (window as any).__hits = []; window.addEventListener('pointerdown', (e) => (window as any).__hits.push((e.target as Element).outerHTML.slice(0, 120) + ' @' + e.clientX + ',' + e.clientY), true); });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    console.log("HITS", JSON.stringify(await page.evaluate(() => (window as any).__hits)), "paused", await video.evaluate((e) => (e as HTMLVideoElement).paused), "expanded", await trigger.getAttribute("aria-expanded"), "BOX3", JSON.stringify(await trigger.boundingBox()));
    await expect(
      dialog.getByRole("complementary", { name: "Video adjustments" }),
    ).toBeVisible();
    expect(
      await video.evaluate((element) => (element as HTMLVideoElement).paused),
    ).toBe(false);

    await page.mouse.move(2, 2);
    await expect(trigger).toHaveCSS("opacity", "0");
    await video.evaluate((element) => (element as HTMLVideoElement).pause());
    await expect(trigger).toHaveCSS("opacity", "1");
  } finally {
    try {
      await app.close();
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
});
