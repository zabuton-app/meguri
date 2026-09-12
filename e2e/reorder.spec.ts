import { _electron, test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Reordering needs two files to drag between, so this spec launches its own
// instance over a temporary media root instead of the shared fixture (whose
// single file the other specs count on).
const require = createRequire(path.join(process.cwd(), "package.json"));
const electronExecutable = require("electron") as string;
const mainScript = path.join(process.cwd(), "out/main/main.js");
const fixtureImage = path.join(process.cwd(), "e2e/fixtures/media/test.png");

test("dragging in manual order reorders without opening the detail view", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-media-"));
  fs.copyFileSync(fixtureImage, path.join(mediaRoot, "aaa.png"));
  fs.copyFileSync(fixtureImage, path.join(mediaRoot, "bbb.png"));

  const env = { ...process.env };
  // Inherited from `npm run test:core` or the shell; makes Electron start as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronExecutable,
    args: [mainScript, `--user-data-dir=${userDataDir}`],
    env: { ...env, MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: mediaRoot },
  });

  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    for (const name of ["aaa.png", "bbb.png"]) {
      await expect(page.getByText(name).first()).toBeVisible({
        timeout: 60_000,
      });
    }

    // Watch Later is a collection, so it carries a manual order to drag in
    // without the setup a user collection would need.
    for (const name of ["aaa.png", "bbb.png"]) {
      const card = page
        .getByTestId("media-card")
        .filter({ hasText: name })
        .first();
      await card.hover();
      await card.getByRole("button", { name: "Add to Watch Later" }).click();
    }
    await page.getByRole("button", { name: "Watch Later", exact: true }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    await page.getByTitle("More conditions").click();
    await page
      .getByRole("combobox")
      .filter({ hasText: /Added|Name/ })
      .first()
      .click();
    await page.getByRole("option", { name: "Manual order" }).click();
    await page.keyboard.press("Escape");

    const cards = page.getByTestId("media-card");
    const from = await cards.nth(0).boundingBox();
    const to = await cards.nth(1).boundingBox();
    if (!from || !to) throw new Error("cards are not laid out");

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(
        from.x + from.width / 2 + ((to.x - from.x) * step) / 12,
        from.y + from.height / 2 + ((to.y - from.y) * step) / 12,
      );
      await page.waitForTimeout(20);
    }
    await page.mouse.up();

    // The drop reorders, and the click the browser fires after it must not
    // follow the dragged card's link into the detail view.
    await expect(cards.nth(0)).toContainText("bbb.png");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).not.toContain("/file/");

    // The next plain click still opens the detail view.
    await cards.first().click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  }
});
