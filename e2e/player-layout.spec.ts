import { _electron, test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

async function expectReviewVisible(page: Page) {
  const panel = page.locator("[data-presentation]");
  const video = panel.locator("video");
  const scenes = panel.getByRole("region", { name: "Scenes", exact: true });
  await expect(video).toBeVisible();
  await expect(scenes).toBeVisible();
  // Visibility alone does not detect partial clipping. Check the actual boxes
  // and every scene's vertical extent against the frame and viewport.
  const bounds = await panel.evaluate((node) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
      };
    };
    return {
      panel: box(node),
      video: box(node.querySelector("video")!),
      scenes: box(node.querySelector(".detail-scenes")!),
      thumbs: Array.from(node.querySelectorAll(".detail-scene-image"), box),
      review: box(node.querySelector('[data-slot="detail-review"]')!),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  expect(bounds.panel.top).toBeGreaterThanOrEqual(-1);
  expect(bounds.panel.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.panel.bottom).toBeLessThanOrEqual(bounds.viewport.height + 1);
  expect(bounds.panel.right).toBeLessThanOrEqual(bounds.viewport.width + 1);
  expect(bounds.video.height).toBeGreaterThan(70);
  expect(bounds.video.bottom).toBeLessThanOrEqual(bounds.scenes.top + 1);
  expect(bounds.scenes.bottom).toBeLessThanOrEqual(bounds.review.bottom + 1);
  expect(bounds.thumbs.length).toBeGreaterThan(0);
  for (const thumb of bounds.thumbs) {
    expect(thumb.top).toBeGreaterThanOrEqual(bounds.scenes.top);
    expect(thumb.bottom).toBeLessThanOrEqual(bounds.scenes.bottom);
    expect(thumb.bottom).toBeLessThan(bounds.viewport.height);
  }
}

test("compact video review keeps scenes visible through edge resizing, scrolling, docking and restart", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-player-layout-"),
  );
  const profile = path.join(temporary, "profile");
  const media = path.join(temporary, "media");
  fs.mkdirSync(profile);
  fs.mkdirSync(media);
  for (const [name, size] of [
    ["Landscape.mp4", "640x360"],
    ["Portrait.mp4", "360x640"],
  ]) {
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=duration=12:size=${size}:rate=2`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      path.join(media, name),
    ]);
  }
  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: [`--user-data-dir=${profile}`],
        env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
      }),
    );
  let app = await launch();
  let page: Page;
  async function resizeWindow(width: number, height: number) {
    await app.evaluate(
      ({ BrowserWindow }, dims) =>
        BrowserWindow.getAllWindows()[0].setContentSize(
          dims.width,
          dims.height,
        ),
      { width, height },
    );
  }
  async function openVideo(name = "Landscape.mp4") {
    await page.getByTitle(name, { exact: true }).click();
    await expect(page.locator("video")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Scenes", exact: true }),
    ).toBeVisible();
  }
  try {
    page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await expect(
      page.getByTitle("Landscape.mp4", { exact: true }),
    ).toBeVisible();
    await waitForIdle(page);
    await resizeWindow(1600, 1000);
    await openVideo();
    const panel = page.locator("[data-presentation]");
    const heading = panel.getByRole("heading", {
      name: "Landscape.mp4",
      exact: true,
    });
    await expect(heading.locator('[data-slot="file-extension"]')).toHaveText(
      "MP4",
    );
    expect(
      await heading.evaluate((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll('.sr-only, [data-slot="file-extension"]')
          .forEach((el) => el.remove());
        return copy.textContent?.trim();
      }),
    ).toBe("Landscape");
    expect((await panel.boundingBox())!.width).toBeLessThan(1000);
    await expectReviewVisible(page);
    const rail = panel.locator('[data-slot="scene-scroll"]').first();
    await expect(
      rail.locator('[data-slot="scroll-area-scrollbar"]'),
    ).toHaveCount(0);
    const railBox = (await rail.boundingBox())!;
    // Drag the native thumb, release, then cross the bar to a scene. Merely
    // moving the mouse must never move the rail after release/cancellation.
    await page.mouse.move(railBox.x + 24, railBox.y + railBox.height - 5);
    await page.mouse.down();
    await page.mouse.move(railBox.x + 150, railBox.y + railBox.height - 5, {
      steps: 10,
    });
    await page.mouse.up();
    const releasedScroll = await rail.evaluate(async (el) => {
      // Native scrollbar updates are committed on the compositor frame.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return el.scrollLeft;
    });
    expect(releasedScroll).toBeGreaterThan(0);
    await page.mouse.move(railBox.x + 300, railBox.y + railBox.height - 5, {
      steps: 10,
    });
    await page.mouse.move(railBox.x + 350, railBox.y + 40, { steps: 10 });
    expect(await rail.evaluate((el) => el.scrollLeft)).toBe(releasedScroll);
    await rail.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.move(railBox.x + 100, railBox.y + railBox.height - 5, {
      steps: 10,
    });
    expect(await rail.evaluate((el) => el.scrollLeft)).toBe(releasedScroll);
    await rail.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 4;
    });
    await page
      .locator("video")
      .evaluate((v) => v.setAttribute("data-same-player", "yes"));
    const title = panel.locator("[data-player-title]");
    // Wait for a stable hit target before starting the native pointer gesture.
    await title.hover();
    const beforeMove = (await panel.boundingBox())!;
    const titleBar = (await title.boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(
      titleBar.x + titleBar.width * 0.5 - 80,
      titleBar.y + titleBar.height / 2 - 25,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await panel.boundingBox())!.x)
      .toBeLessThan(beforeMove.x - 60);
    for (const edgeName of ["topLeft", "topRight", "bottomLeft", "corner"]) {
      const handle = panel.locator(`[data-resize-edge="${edgeName}"]`);
      const box = (await handle.boundingBox())!;
      await handle.hover();
      await expect(handle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 12,
        box.y + box.height / 2 + 12,
        { steps: 4 },
      );
      await page.mouse.up();
      await expectReviewVisible(page);
    }
    const initial = (await panel.boundingBox())!;
    const handle = panel.locator('[data-resize-edge="right"]');
    const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + 100, edge.y + edge.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeGreaterThan(initial.width + 80);
    await expectReviewVisible(page);
    // Shrink vertically: thumbnails must follow the frame height too.
    const bottom = (await panel
      .locator('[data-resize-edge="bottom"]')
      .boundingBox())!;
    await page.mouse.move(
      bottom.x + bottom.width / 2,
      bottom.y + bottom.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y - 100, {
      steps: 12,
    });
    await page.mouse.up();
    await expectReviewVisible(page);
    const thumbHeight = await panel
      .locator(".detail-scene-image")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(thumbHeight).toBeLessThan(96);
    const saved = await page.evaluate(() =>
      localStorage.getItem("meguri.media.detail.dimensions.v1"),
    );
    expect(saved).toBeTruthy();
    const reviewBefore = await panel
      .locator('[data-slot="detail-review"]')
      .boundingBox();
    await panel
      .locator(
        '[data-slot="detail-metadata"] [data-slot="scroll-area-viewport"]',
      )
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    expect(
      await panel.locator('[data-slot="detail-review"]').boundingBox(),
    ).toEqual(reviewBefore);
    await expectReviewVisible(page);
    // Picking a scene updates this same player without having to scroll back.
    const scene = panel
      .getByRole("region", { name: "Scenes" })
      .getByTitle(/^Seek to/)
      .first();
    await scene.click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeLessThan(1);
    await expect(page.locator("video")).toHaveAttribute(
      "data-same-player",
      "yes",
    );
    // The scene's star remains reachable and saves the chosen main thumbnail.
    await scene.hover();
    await panel
      .getByRole("region", { name: "Scenes" })
      .getByRole("button", { name: "Set as main thumbnail", exact: true })
      .first()
      .click();
    await expect(
      panel.getByRole("region", { name: "Scenes" }).getByRole("button", {
        name: "Revert to auto thumbnail",
        exact: true,
      }),
    ).toBeVisible();
    // On macOS the DOM fullscreen event precedes the native window animation.
    // Wait for Electron's completion event before asking it to exit again.
    const nativeFullscreen = (
      event: "enter-full-screen" | "leave-full-screen",
    ) =>
      process.platform === "darwin"
        ? app.evaluate(
            ({ BrowserWindow }, event) =>
              new Promise<void>((resolve) => {
                const window = BrowserWindow.getAllWindows()[0];
                if (event === "enter-full-screen")
                  window.once("enter-full-screen", resolve);
                else window.once("leave-full-screen", resolve);
              }),
            event,
          )
        : Promise.resolve();
    const enteredFullscreen = nativeFullscreen("enter-full-screen");
    await page.getByTitle("Fullscreen (F)", { exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement != null))
      .toBe(true);
    await expectReviewVisible(page);
    await enteredFullscreen;
    const leftFullscreen = nativeFullscreen("leave-full-screen");
    await page.getByTitle("Fullscreen (F)", { exact: true }).click();
    await leftFullscreen;
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement == null))
      .toBe(true);
    await page
      .getByRole("button", { name: "Enlarge modal", exact: true })
      .click();
    await expectReviewVisible(page);
    await page
      .getByRole("button", { name: "Shrink modal", exact: true })
      .click();
    await expectReviewVisible(page);
    await page
      .getByRole("button", { name: "Open as side peek", exact: true })
      .click();
    await expectReviewVisible(page);
    await page
      .getByRole("button", { name: "Open as modal", exact: true })
      .click();
    await expect(page.locator("video")).toHaveAttribute(
      "data-same-player",
      "yes",
    );
    await resizeWindow(900, 600);
    await expectReviewVisible(page);
    await page.keyboard.press("Escape");
    await openVideo("Portrait.mp4");
    await expectReviewVisible(page);
    await page.keyboard.press("Escape");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByTitle("Landscape.mp4", { exact: true }),
    ).toBeVisible();
    await openVideo();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("meguri.media.detail.dimensions.v1"),
      ),
    ).toBe(saved);
    await expectReviewVisible(page);
    // Keyboard resizing must consume arrow keys, not seek the video.
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 4;
    });
    const beforeKey = (await page.locator("[data-presentation]").boundingBox())!
      .width;
    await page
      .getByRole("separator", { name: "Resize player width", exact: true })
      .last()
      .focus();
    await page.keyboard.press("ArrowLeft");
    expect(
      (await page.locator("[data-presentation]").boundingBox())!.width,
    ).toBeLessThan(beforeKey);
    expect(
      await page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBeCloseTo(4, 0);
    await expectReviewVisible(page);
    const separateWindow = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Open in separate window", exact: true })
      .click();
    const preview = await separateWindow;
    await preview.waitForLoadState("domcontentloaded");
    await expect(preview.locator("video")).toBeVisible();
    await expect
      .poll(() =>
        preview
          .locator("video")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(4, 0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByTitle("Landscape.mp4", { exact: true }),
    ).toBeVisible();
    await expect(preview.locator("[data-resize-edge]")).toHaveCount(0);
    await expectReviewVisible(preview);
    await preview.getByRole("button", { name: "5 stars", exact: true }).click();
    await expect(
      page
        .getByTestId("media-card")
        .filter({ hasText: "Landscape.mp4" })
        .getByRole("img", { name: "Rated 5 of 5", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes("/detached/"),
      )!;
      if (win.getParentWindow())
        throw new Error("Preview must be an independent window");
      const bounds = win.getBounds();
      win.setPosition(bounds.x + 40, bounds.y + 20);
    });
    await preview
      .getByRole("button", { name: "Close (Esc)", exact: true })
      .click();
    await expect.poll(() => app.windows().length).toBe(1);
    await expect(
      page.getByTitle("Landscape.mp4", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
