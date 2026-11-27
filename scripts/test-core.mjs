// Run the core tests under Electron's own Node (ELECTRON_RUN_AS_NODE), so
// better-sqlite3's build for Electron loads, as in the app. The environment is
// set here rather than in package.json, whose `VAR=value command` form only a
// POSIX shell understands; cmd and PowerShell fail on it (#297). Extra
// arguments go to Vitest.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// The electron package's main export is the path to its executable.
const electron = require("electron");
const vitest = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  // Allows require() of ESM (docs/build-and-ci.md, "Core project").
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-require-module"]
    .filter(Boolean)
    .join(" "),
};

// No shell: the executable is a full path, so nothing needs quoting.
const child = spawn(
  electron,
  [vitest, "run", "--project", "core", ...process.argv.slice(2)],
  { env, stdio: "inherit" },
);

// Pass a stop request on to Electron, as the electron CLI the old command used
// did: stopping only this launcher would leave the tests and their workers
// running.
const forwarded = ["SIGINT", "SIGTERM"];
for (const signal of forwarded) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    // Our own handlers would swallow the signal re-raised below.
    for (const s of forwarded) process.removeAllListeners(s);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
