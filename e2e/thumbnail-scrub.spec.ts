import { _electron, test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("scrubs cleanly and enlarges beside the original thumbnail in grid and list views", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-scrub-e2e-"));
  const media = path.join(temporary, "media");
  const profile = path.join(temporary, "profile");
  fs.mkdirSync(media);
  fs.mkdirSync(profile);
  const filename = "Harbour.sunset.final.v2.mp4";
  execFileSync(ffmpeg!, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=duration=12:size=640x360:rate=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    path.join(media, filename),
  ]);
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${profile}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
    }),
  );
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await skipFirstLaunchTour(page);
    await expect(page.getByTitle(filename, { exact: true })).toBeVisible();
    await waitForIdle(page);
    const enlargeKey = process.platform === "darwin" ? "Meta" : "Control";
    for (const view of ["Grid view", "List view"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const name = page.getByTitle(filename, { exact: true });
      // The suffix remains available to assistive technology, but is visually
      // separated into the metadata, leaving the full line for the stem.
      expect(
        await name.evaluate((node) => {
          const copy = node.cloneNode(true) as HTMLElement;
          copy
            .querySelectorAll(".sr-only")
            .forEach((suffix) => suffix.remove());
          return copy.textContent;
        }),
      ).toBe("Harbour.sunset.final.v2");
      await expect(
        page
          .getByText(/\bMP4\b/)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      const surface = page.locator("[data-scrub-surface]").first();
      const anchor = await surface.boundingBox();
      expect(anchor).not.toBeNull();
      const x = anchor!.x + anchor!.width * 0.25;
      const y = anchor!.y + anchor!.height * 0.5;
      await page.mouse.move(x, y);
      const arrow = surface.getByTitle("Drag to another app");
      await expect(arrow).toBeVisible();
      const frame = surface.locator('img[src*="/frame/"]');
      await expect(frame).toBeVisible();
      await expect
        .poll(() =>
          frame.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);

      // Press keys while already hovering: no extra movement needed.
      await page.keyboard.down("Alt");
      await expect(arrow).toBeHidden();
      for (const control of await surface.locator("button").all())
        await expect(control).toBeHidden();
      await expect(surface.locator("svg:visible")).toHaveCount(0);
      await expect(surface.locator("[data-thumbnail-overlay]")).toBeHidden();
      await page.keyboard.down(enlargeKey);
      const popup = page.locator('[data-slot="enlarged-scrub-preview"]');
      await expect(popup).toBeVisible();
      await expect
        .poll(() =>
          popup
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThanOrEqual(720);

      const bounds = await popup.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThan(anchor!.width);
      expect(bounds!.width).toBeLessThanOrEqual(anchor!.width * 2 + 1);
      expect(bounds!.height).toBeLessThanOrEqual(anchor!.height * 2 + 1);
      expect(
        bounds!.x >= anchor!.x + anchor!.width + 10 ||
          bounds!.x + bounds!.width <= anchor!.x - 10 ||
          bounds!.y >= anchor!.y + anchor!.height + 10 ||
          bounds!.y + bounds!.height <= anchor!.y - 10,
      ).toBe(true);
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await expect(popup.locator("svg, button, video, audio")).toHaveCount(0);
      await expect(popup).toHaveCSS("pointer-events", "none");
      const firstFrame = await frame.getAttribute("src");
      await page.mouse.move(anchor!.x + anchor!.width * 0.8, y);
      await expect(frame).not.toHaveAttribute("src", firstFrame!);
      expect(await popup.boundingBox()).toEqual(bounds);
      await expect(popup.locator("img")).toHaveAttribute(
        "src",
        (await frame.getAttribute("src")) as string,
      );
      await page.keyboard.up(enlargeKey);
      await expect(popup).toHaveCount(0);
      await expect(arrow).toBeHidden();
      await page.keyboard.up("Alt");
      await expect(arrow).toBeVisible();
      // Scroll dismissal must remove the detached portal immediately.
      await page.keyboard.down("Alt");
      await page.keyboard.down(enlargeKey);
      await expect(popup).toBeVisible();
      await page.mouse.wheel(0, 200);
      // Even a non-scrolling short list can receive no scroll event; leaving
      // the surface always dismisses and prevents an orphaned popup.
      await page.mouse.move(0, 0);
      await expect(popup).toHaveCount(0);
      await page.keyboard.up(enlargeKey);
      await page.keyboard.up("Alt");
    }
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
