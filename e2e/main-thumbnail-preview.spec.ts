import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath as ffmpeg } from "@zabuton-app/ffmpeg-binaries";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  closeTopDialog,
  openFileDetail,
  skipFirstLaunchTour,
  waitForIdle,
  waitForIndexedMedia,
} from "./fixtures/helpers";

// #295: the grid fetches each thumbnail under its own `?v=` count while the
// scan runs, and the detail view counts from 0, so after "Set as main
// thumbnail" the detail view could ask for a URL the grid had already cached
// with the old picture.
test("shows a newly chosen main thumbnail in the detail view right away", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-main-thumb-"));
  const root = path.join(temp, "media");
  fs.mkdirSync(root);
  const name = "Main thumbnail fixture.mkv";
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
    await waitForIndexedMedia(page, name);
    // The scene list needs the duration, which is probed after the row shows.
    await waitForIdle(page);
    const dialog = page.getByRole("dialog");
    const preview = dialog
      .getByText("Current main thumbnail:")
      .locator("..")
      .locator("img");
    // Screenshots of one picture can differ by a level or two in a few
    // pixels from one render to the next, so compare decoded pixels with a
    // margin instead of the PNG bytes. The page decodes them.
    const pixels = (shot: Buffer) =>
      page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes]));
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return Array.from(
          context.getImageData(0, 0, image.width, image.height).data,
        );
      }, shot.toString("base64"));
    const same = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 16);
    // The preview's picture once it has loaded `?v=<version>` and the dialog
    // has stopped animating.
    const settled = async (version: number) => {
      await expect(preview).toHaveAttribute("src", new RegExp(`v=${version}$`));
      await expect(preview).toHaveJSProperty("complete", true);
      let shot = await pixels(await preview.screenshot());
      await expect
        .poll(
          async () => {
            const last = shot;
            shot = await pixels(await preview.screenshot());
            return same(shot, last);
          },
          {
            message: `preview at ?v=${version} stops changing`,
            intervals: [200],
            timeout: 10_000,
          },
        )
        .toBe(true);
      return shot;
    };
    const open = async () => {
      await openFileDetail(page, name);
      return settled(0);
    };
    const choose = async (scene: number) => {
      // The star shows while its scene is hovered. Scenes still loading can
      // shift the row from under the pointer, so hover again until it clicks.
      const box = dialog
        .getByTitle(/^Seek to /)
        .nth(scene)
        .locator("..");
      await expect(async () => {
        await box.hover();
        await box
          .getByRole("button", { name: "Set as main thumbnail" })
          .click({ timeout: 1_000 });
      }).toPass();
      return settled(1);
    };

    const auto = await open();
    const first = await choose(3);
    expect(same(first, auto)).toBe(false);

    // Reopening starts the detail view's count again, while the grid under it
    // has already fetched `?v=1` with the first choice.
    await closeTopDialog(page);
    expect(same(await open(), first)).toBe(true);
    const second = await choose(6);
    expect(same(second, first)).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
