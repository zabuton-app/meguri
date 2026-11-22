import { spawn, type ChildProcess } from "node:child_process";
import type { FullConfig } from "@playwright/test";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";

// Starts an Xvfb server and resolves with its display (":N") once it accepts
// connections; -displayfd picks a free display number and reports it on fd 3.
function startXvfb(): Promise<{ display: string; server: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const server = spawn(
      "Xvfb",
      ["-displayfd", "3", "-screen", "0", "1280x960x24", "-nolisten", "tcp"],
      { stdio: ["ignore", "ignore", "ignore", "pipe"] },
    );
    let output = "";
    server.stdio[3]?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("\n"))
        resolve({ display: `:${output.trim()}`, server });
    });
    server.on("error", reject);
    server.on("exit", (code) =>
      reject(new Error(`Xvfb exited with code ${code}`)),
    );
  });
}

// The electron package has no install script: it downloads its binary on the
// first require("electron") after a fresh install, as on every CI job. Resolve it
// once here, through the same path the specs use, before the workers start, so
// parallel workers do not download it at the same time and launch a binary
// another one is still writing (spawn ETXTBSY).
//
// With MEGURI_E2E_XVFB=1 (`test:e2e:headless`), each worker also gets its own
// Xvfb display (picked in electronLaunchOptions). On one shared display the X
// pointer sits inside every worker's window, so another worker's window opening
// or closing over ours sends it a real pointer leave/enter. Chromium drops a
// pending drag on that, so a Playwright dragTo between its mouse down and move
// starts no drag and drops nothing (#463).
export default async function globalSetup(
  config: FullConfig,
): Promise<(() => void) | void> {
  electronLaunchOptions();
  if (process.env.MEGURI_E2E_XVFB !== "1") return;
  const started = await Promise.allSettled(
    Array.from({ length: config.workers }, startXvfb),
  );
  const servers = started.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const stopAll = () => {
    for (const { server } of servers) {
      server.removeAllListeners("exit");
      server.kill();
    }
  };
  const failed = started.find((result) => result.status === "rejected");
  if (failed) {
    stopAll();
    throw failed.reason;
  }
  // Workers start after global setup and inherit this environment.
  process.env.MEGURI_E2E_DISPLAYS = servers
    .map(({ display }) => display)
    .join(",");
  return stopAll;
}
