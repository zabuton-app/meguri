import { test, expect } from "./fixtures/app";

test("empty filtered views show no footage and give readable filter feedback", async ({
  ready: page,
}) => {
  await page
    .getByRole("button", { name: "Create smart bin", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Create smart bin",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("4K images");
  await editor.getByRole("radio", { name: "Image", exact: true }).click();
  await editor
    .getByRole("combobox", { name: "Resolution", exact: true })
    .click();
  await page
    .getByRole("option", { name: "4K UHD (3840 × 2160)", exact: true })
    .click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  const banner = page.locator('[data-slot="smart-bin-context"]');
  await expect(banner).toContainText("4K images");
  await expect(banner).toContainText("3840 × 2160");
  const rules = banner.locator("span[title]").first();
  const contrast = await rules.evaluate((el) => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const v = channel / 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
    const luminance = (value: string) =>
      rgb(value).reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
    const fg = luminance(getComputedStyle(el).color);
    const bg = luminance(
      getComputedStyle(el.closest('[data-slot="smart-bin-context"]')!)
        .backgroundColor,
    );
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(rules).toHaveCSS("font-weight", "600");
  for (const view of ["Grid view", "List view", "Timeline view"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(
      page.getByText("No files match these filter criteria.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("media-card")).toHaveCount(0);
    await expect(
      page.getByRole("main").locator('a[href*="/file/"]'),
    ).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Leave smart bin", exact: true })
    .click();
  await expect(
    page.getByText("No files match these filter criteria.", { exact: true }),
  ).toHaveCount(0);
});
