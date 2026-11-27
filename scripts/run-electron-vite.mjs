import { spawn } from "node:child_process";

const command = process.argv[2] ?? "dev";
const args = process.argv.slice(3);
const env = { ...process.env };

// A terminal inside another Electron app (an editor) can pass these on to
// its children; they would run Electron as Node, or as a packaged app that
// ignores the dev server.
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_FORCE_IS_PACKAGED;

const child = spawn("electron-vite", [command, ...args], {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
