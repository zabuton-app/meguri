import { _electron, test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
import {
  fileCard,
  skipFirstLaunchTour,
  waitForIdle,
  openFileDetail,
} from "./fixtures/helpers";

test("audio Smart bins replace resolution and preserve audio properties across folders and restart", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-audio-bins-"),
  );
  const profile = path.join(temporary, "profile");
  const first = path.join(temporary, "Audio A");
  const second = path.join(temporary, "Audio B");
  for (const directory of [profile, first, second]) fs.mkdirSync(directory);
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({ roots: [first, second], activePath: "__all__" }),
  );
  for (const [destination, rate, channels, codec] of [
    [path.join(first, "stereo-a.wav"), "96000", "2", "pcm_s24le"],
    [path.join(second, "stereo-b.wav"), "96000", "2", "pcm_s24le"],
    [path.join(second, "higher.wav"), "192000", "2", "pcm_s32le"],
    [path.join(first, "mono.wav"), "48000", "1", "pcm_s16le"],
  ])
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-ar",
      rate,
      "-ac",
      channels,
      "-c:a",
      codec,
      destination,
    ]);

  const launch = () =>
    _electron.launch(
      electronLaunchOptions({
        args: ["--user-data-dir=" + profile],
        env: { MEGURI_DISABLE_TRAY: "1" },
      }),
    );
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await skipFirstLaunchTour(page);
    await expect(fileCard(page, "stereo-a.wav")).toBeVisible();
    await waitForIdle(page);
    await page
      .getByRole("combobox", { name: "Resolution", exact: true })
      .click();
    await page
      .getByRole("option", { name: "1440p QHD (2560 × 1440)", exact: true })
      .click();
    await page.getByRole("radio", { name: "Audio", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Resolution", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("media-card")).toHaveCount(4);

    await page
      .getByRole("button", { name: "Create smart bin", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create smart bin",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("96 kHz stereo");
    await dialog
      .getByRole("button", { name: "Audio properties", exact: true })
      .click();
    const audio = page.getByRole("dialog", {
      name: "Audio properties",
      exact: true,
    });
    for (const [name, option] of [
      ["Sample rate", "96 kHz"],
      ["Bit depth", "24-bit"],
      ["Sample rate match", "At least"],
      ["Bit depth match", "At least"],
      ["Channels", "Stereo"],
      ["Codec", "PCM"],
    ]) {
      await audio.getByRole("combobox", { name, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    const choose = async (name: string, option: string) => {
      await audio.getByRole("combobox", { name, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await choose("Duration format", "Minutes");
    await audio
      .getByRole("textbox", { name: "At least (Minutes)", exact: true })
      .fill("0.01");
    await audio
      .getByRole("textbox", { name: "At most (Minutes)", exact: true })
      .fill("0.04");
    await choose("Duration format", "Minutes:seconds (MM:SS)");
    const minimum = audio.getByRole("textbox", {
      name: "At least (MM:SS)",
      exact: true,
    });
    const maximum = audio.getByRole("textbox", {
      name: "At most (MM:SS)",
      exact: true,
    });
    await expect(minimum).toHaveValue("00:00.6");
    await expect(maximum).toHaveValue("00:02.4");
    await expect(audio.getByText(/Enter MM:SS, e.g. 02:30/)).toBeVisible();
    await minimum.fill("2:90");
    await expect(minimum).toHaveAttribute("aria-invalid", "true");
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await minimum.fill("00:00.50");
    await maximum.fill("00:02");
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    await choose("Duration match", "Exactly");
    await audio
      .getByRole("textbox", { name: "Duration (MM:SS)", exact: true })
      .fill("00:01");
    await choose("Duration match", "At least");
    await expect(
      audio.getByRole("textbox", { name: "At most (MM:SS)", exact: true }),
    ).toHaveCount(0);
    await choose("Duration match", "At most");
    await expect(
      audio.getByRole("textbox", { name: "At least (MM:SS)", exact: true }),
    ).toHaveCount(0);
    await choose("Duration match", "Between");
    await minimum.fill("00:03");
    await maximum.fill("00:02");
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await minimum.fill("00:00.50");
    await audio
      .getByRole("spinbutton", { name: "Minimum bitrate (kbps)", exact: true })
      .fill("1000");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(3);
    const detail = await openFileDetail(page, "stereo-a.wav");
    await expect(detail.getByText("96 kHz", { exact: true })).toBeVisible();
    await expect(detail.getByText("24-bit", { exact: true })).toBeVisible();
    await expect(detail.getByText("Stereo", { exact: true })).toBeVisible();
    await expect(detail.getByText("Resolution", { exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("complementary", { name: "Smart bins" })
      .getByRole("button", { name: "96 kHz stereo", exact: false })
      .first()
      .click();
    await expect(page.getByTestId("media-card")).toHaveCount(3);
    await expect(fileCard(page, "mono.wav")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Resolution", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Video", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Audio properties/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Resolution", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Audio", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(4);
  } finally {
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
