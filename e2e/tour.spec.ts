import { test, expect } from "./fixtures/app";
import { openSettingsTab, waitForIndexedMedia } from "./fixtures/helpers";

test.describe("Tour", () => {
  test("runs on first launch, can be skipped and does not come back", async ({
    firstLaunchWindow: page,
  }) => {
    const bubble = page.getByRole("dialog", { name: "Choose your language" });
    await expect(bubble).toBeVisible({ timeout: 30_000 });
    // The pet is out by default, so it does the talking.
    await expect(page.locator("[data-pet] [data-tour-bubble]")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("dialog", { name: "Welcome to Meguri" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add a folder" }),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("dialog", { name: "Collections" }),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByRole("dialog", { name: "Add a folder" }),
    ).toBeVisible();

    // On the pet's own step the pet is the highlighted target; the bubble it
    // draws must still take clicks.
    const petStep = page.getByRole("dialog", { name: "Your pet" });
    for (let i = 0; i < 8 && !(await petStep.isVisible()); i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(petStep).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(petStep).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-tour-bubble]")).toHaveCount(0);
    await expect(page.locator(".driver-overlay")).toHaveCount(0);

    // Recorded as seen; and after a reload the tour does not start again.
    expect(
      await page.evaluate(() => localStorage.getItem("meguri.tours")),
    ).toContain("first-launch");
    await page.reload();
    await waitForIndexedMedia(page);
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-tour-bubble]")).toHaveCount(0);
  });

  test("goes on in the language chosen first, and keeps it", async ({
    firstLaunchWindow: page,
  }) => {
    await expect(
      page.getByRole("dialog", { name: "Choose your language" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "日本語" }).click();
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(
      page.getByRole("dialog", { name: "Meguriへようこそ" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await waitForIndexedMedia(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByPlaceholder("ファイル名・タグを検索")).toBeVisible();
  });

  test("can be replayed from settings", async ({ ready }) => {
    const dialog = await openSettingsTab(ready, "App");
    await dialog.getByRole("button", { name: "Replay" }).click();
    await expect(
      ready.getByRole("dialog", { name: "Choose your language" }),
    ).toBeVisible();
    await ready.getByRole("button", { name: "Skip" }).click();
    await expect(ready.locator("[data-tour-bubble]")).toHaveCount(0);
  });
});
