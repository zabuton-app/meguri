import {
  _electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitForIndexedMedia } from "./helpers";

const require = createRequire(path.join(process.cwd(), "package.json"));
const electronExecutable = require("electron") as string;

const repoRoot = process.cwd();
const mainScript = path.join(repoRoot, "out/main/main.js");
const mediaRoot = path.join(repoRoot, "e2e/fixtures/media");

export interface MeguriFixtures {
  app: ElectronApplication;
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
    const env = { ...process.env };
    // Inherited from `npm run test:core` or the shell; makes Electron start as Node
    // and reject Playwright's debug flags.
    delete env.ELECTRON_RUN_AS_NODE;

    const app = await _electron.launch({
      executablePath: electronExecutable,
      args: [mainScript, `--user-data-dir=${userDataDir}`],
      env: {
        ...env,
        MEGURI_DISABLE_TRAY: "1",
        MEGURI_ROOT: mediaRoot,
      },
    });

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
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
  ready: async ({ window }, use) => {
    await waitForIndexedMedia(window);
    await use(window);
  },
});

export { expect } from "@playwright/test";
