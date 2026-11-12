import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import { appBuildConfig } from "./electron.vite.shared";

// Build the main process (Node) / preload / renderer (React) with a single
// config. The settings are in electron.vite.shared.ts so another project can
// build the same out/ layout with its own entry point.
export default defineConfig(
  appBuildConfig({ mainEntry: resolve("electron/main.ts") }),
);
