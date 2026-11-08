import {
  _electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skipFirstLaunchTour, waitForIndexedMedia } from "./helpers";
import {
  electronLaunchOptions,
  mainScript,
} from "../../scripts/electron-launch.cjs";

const mediaRoot = path.join(process.cwd(), "e2e/fixtures/media");

export interface MeguriFixtures {
  app: ElectronApplication;
  /** The window as a brand-new user sees it, first-launch tour included. */
  firstLaunchWindow: Page;
  /** The window with the first-launch tour already seen. */
  window: Page;
  /** Same window after the fixture media appears in the list. */
  ready: Page;
}

export const test = base.extend<MeguriFixtures>({
  app: async ({}, use) => {
    if (!fs.existsSync(mainScript)) {
      throw new Error(
        "Built main script not found. Run `npm run build` before E2E tests.",
      );
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
    const app = await _electron.launch(
      electronLaunchOptions({
        args: [`--user-data-dir=${userDataDir}`],
        env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: mediaRoot },
      }),
    );

    try {
      await use(app);
    } finally {
      try {
        await app.close();
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  },
  firstLaunchWindow: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await skipFirstLaunchTour(window);
    await use(window);
  },
  ready: async ({ window }, use) => {
    await waitForIndexedMedia(window);
    await use(window);
  },
});

export { expect } from "@playwright/test";
