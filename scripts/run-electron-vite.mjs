import { spawn } from "node:child_process";

const command = process.argv[2] ?? "dev";
const args = process.argv.slice(3);
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

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
