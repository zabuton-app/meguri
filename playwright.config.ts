import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // Every test that launches the app (the fixture in e2e/fixtures/app.ts, and specs
  // that launch their own) gives it a fresh --user-data-dir, so the single-instance
  // lock, which is held per user data directory, does not collide across workers.
  // Files still run their tests in order. Two workers fit the 4-vCPU ubuntu runner
  // in test.yml, where each one runs a full Electron app; local runs use the same.
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    trace: "retain-on-failure",
  },
});
