// Shared launch options for every place that starts the built app with
// Playwright's `_electron` (e2e/ specs and tools/demo-capture). CommonJS so both
// the Playwright-transpiled specs and the .mjs tools can load it.
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

exports.mainScript = path.join(repoRoot, "out/main/main.js");

/**
 * `test:e2e:headless` sets MEGURI_FORCE_X11=1 and runs on Xvfb: one display per
 * Playwright worker, started by e2e/global-setup.ts and listed in
 * MEGURI_E2E_DISPLAYS (indexed by the worker's TEST_PARALLEL_INDEX).
 * Xvfb only changes DISPLAY, so from a Wayland session Electron would still
 * connect to Wayland (showing windows on the real desktop, or failing to
 * start). Pinning to X11 needs both the switch and the env cleanup below, and
 * both are applied after the caller's options so they cannot be overridden.
 */
exports.electronLaunchOptions = function electronLaunchOptions({
  args = [],
  env = {},
} = {}) {
  const forceX11 = process.env.MEGURI_FORCE_X11 === "1";
  const launchEnv = { ...process.env, ...env };
  // Inherited from `npm run test:core` or the shell; makes Electron start as
  // Node and reject Playwright's debug flags.
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const displays = process.env.MEGURI_E2E_DISPLAYS?.split(",");
  if (displays) {
    launchEnv.DISPLAY =
      displays[Number(process.env.TEST_PARALLEL_INDEX ?? 0) % displays.length];
  }
  let launchArgs = [exports.mainScript, ...args];
  if (forceX11) {
    delete launchEnv.WAYLAND_DISPLAY;
    delete launchEnv.ELECTRON_OZONE_PLATFORM_HINT;
    launchEnv.XDG_SESSION_TYPE = "x11";
    launchArgs = [
      "--ozone-platform=x11",
      ...launchArgs.filter((arg) => !arg.startsWith("--ozone-platform")),
    ];
  }
  return {
    executablePath: /** @type {string} */ (require("electron")),
    args: launchArgs,
    env: launchEnv,
  };
};
