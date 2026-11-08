import { _electron, test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import { fileCard, skipFirstLaunchTour, waitForIdle } from "./fixtures/helpers";

test("keeps bin identity and incoming filters, checking compatibility once per visit", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-bin-visits-"),
  );
  const media = path.join(temporary, "media");
  const profile = path.join(temporary, "profile");
  fs.mkdirSync(media);
  fs.mkdirSync(profile);
  for (const [name, size] of [
    ["video-4k.mp4", "3840x2160"],
    ["video-hd.mp4", "1280x720"],
  ])
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `color=c=blue:s=${size}:r=1`,
      "-frames:v",
      "1",
      path.join(media, name),
    ]);
  for (const rate of [48000, 96000])
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-ar",
      String(rate),
      "-c:a",
      "pcm_s24le",
      path.join(media, `audio-${rate}.wav`),
    ]);
  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: [`--user-data-dir=${profile}`],
        env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: media },
      }),
    );
  let app = await launch();
  let page: Page;
  const binButton = (name: string) =>
    page
      .getByRole("complementary", { name: "Smart bins" })
      .getByRole("button", { name, exact: false })
      .first();
  const audioPanel = () =>
    page.getByRole("dialog", { name: "Audio properties", exact: true });
  async function sampleRate(value: string) {
    await page.getByRole("button", { name: /^Audio properties/ }).click();
    await audioPanel()
      .getByRole("combobox", { name: "Sample rate", exact: true })
      .click();
    await page.getByRole("option", { name: value, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  try {
    page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await expect(fileCard(page, "video-4k.mp4")).toBeVisible();
    await waitForIdle(page);
    for (const name of [
      "video-4k.mp4",
      "video-hd.mp4",
      "audio-48000.wav",
      "audio-96000.wav",
    ])
      await fileCard(page, name)
        .getByRole("button", { name: "4 stars", exact: true })
        .click();
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(
        "meguri.smartCollections.v1",
        JSON.stringify([
          {
            id: "footage",
            name: "Footage",
            scope: "all",
            query: {
              kind: "video",
              resolution: { preset: "uhd", match: "atLeast" },
            },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "audio48",
            name: "48 kHz audio",
            scope: "all",
            query: { kind: "audio", audio: { sampleRate: 48000 } },
            createdAt: now,
            updatedAt: now,
          },
        ]),
      );
    });
    await page.reload();
    // 720p is applicable to video. Preserve it and let the 4K bin's AND
    // intersection return zero instead of pausing a valid resolution value.
    await page
      .getByRole("combobox", { name: "Resolution", exact: true })
      .click();
    await page
      .getByRole("option", { name: "720p HD (1280 × 720)", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Resolution match", exact: true })
      .click();
    await page.getByRole("option", { name: "Exactly", exact: true }).click();
    await binButton("Footage").click();
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByText("No files match these filter criteria.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="held-filters"]')).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Resolution", exact: true }),
    ).toContainText("720p");
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect(fileCard(page, "video-4k.mp4")).toBeVisible();
    await page
      .getByRole("button", { name: "Browse without a smart bin", exact: true })
      .click();
    await page.getByRole("radio", { name: "Audio", exact: true }).click();
    await sampleRate("96 kHz");
    await page
      .getByTitle("Filter by minimum rating", { exact: true })
      .getByRole("button", { name: "4 stars", exact: true })
      .click();
    await expect(fileCard(page, "audio-96000.wav")).toBeVisible();
    await binButton("Footage").click();
    await expect(binButton("Footage")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByText("Filter combination has no matches.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: /Enable filter: Sample rate: 96 kHz/ }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /^New files/ }).click();
    const recent = page.getByRole("dialog", { name: "New files", exact: true });
    await recent.getByRole("combobox", { name: "Time window" }).click();
    await page.getByRole("option", { name: "Today", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(binButton("Footage")).toHaveAttribute("aria-current", "true");
    await page
      .getByRole("button", { name: "Edit smart bin: Footage", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit smart bin",
      exact: true,
    });
    await editor.getByRole("radio", { name: "Audio", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    // The bin now accepts audio, but its previously excluded 96 kHz visitor
    // filter must stay out until the next visit (or an explicit manual edit).
    await expect(binButton("Footage")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByRole("switch", { name: /Enable filter: Sample rate: 96 kHz/ }),
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: /Enable filter: Sample rate: 96 kHz/ }),
    ).toHaveAttribute("aria-checked", "false");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(binButton("Footage")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New files Today" }),
    ).toBeVisible();
    const rememberedRate = () =>
      page.getByRole("switch", { name: /Enable filter: Sample rate: 96 kHz/ });
    await expect(rememberedRate()).toBeEnabled();
    await expect(rememberedRate()).toHaveAttribute("aria-checked", "false");
    await rememberedRate().click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Edit smart bin: Footage", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit smart bin", exact: true })
      .getByRole("radio", { name: "Video", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit smart bin", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(rememberedRate()).toBeDisabled();
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit smart bin: Footage", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit smart bin", exact: true })
      .getByRole("radio", { name: "Audio", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit smart bin", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(rememberedRate()).toBeEnabled();
    await expect(rememberedRate()).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await binButton("48 kHz audio").click();
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByText("Filter combination has no matches.", { exact: true }),
    ).toBeVisible();
    await expect(binButton("48 kHz audio")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await binButton("Footage").click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await expect(fileCard(page, "audio-96000.wav")).toBeVisible();
    // Leaving the bin is explicit; changing Global/Local keeps its rules.
    await page
      .getByRole("button", { name: "Browse without a smart bin", exact: true })
      .click();
    await expect(page.locator('[data-slot="smart-bin-context"]')).toHaveCount(
      0,
    );
    await sampleRate("48 kHz");
    await binButton("Footage").click();
    await expect(fileCard(page, "audio-48000.wav")).toBeVisible();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect(binButton("Footage")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("media-card")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Browse without a smart bin", exact: true })
      .click();
    await page.getByRole("radio", { name: "Video", exact: true }).click();
    await binButton("48 kHz audio").click();
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByText("No files match these filter criteria.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Enable filter: Video", exact: true }),
    ).toBeDisabled();
    await page
      .getByTitle("Filter by minimum rating", { exact: true })
      .getByRole("button", { name: "4 stars", exact: true })
      .click();
    await expect(
      page.getByText("Filter combination has no matches.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Remove remembered filter: Video",
        exact: true,
      })
      .click();
    await expect(fileCard(page, "audio-48000.wav")).toBeVisible();
    await expect(binButton("48 kHz audio")).toHaveAttribute(
      "aria-current",
      "true",
    );
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
