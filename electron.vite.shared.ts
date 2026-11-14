import type { UserConfig } from "electron-vite";
import { externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This repository's root. Its sources are found from here, not from the
// working directory, so a project that keeps this repository in a
// subdirectory builds the same files.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const fromRepo = (...parts: string[]): string => resolve(repoRoot, ...parts);

// The packages the main process and preload load at runtime. Externalizing
// them by name keeps them out of the bundle even when the building project's
// own package.json does not list them (it still has to install them).
const { dependencies } = JSON.parse(
  readFileSync(fromRepo("package.json"), "utf8"),
) as { dependencies: Record<string, string> };
const runtimeDeps = Object.keys(dependencies);

/**
 * index.html's CSP is the packaged app's. The dev server also needs its own
 * origin over http and its HMR socket; add those while serving only.
 */
function devServerCsp(): Plugin {
  return {
    name: "dev-server-csp",
    apply: "serve",
    transformIndexHtml(html) {
      const prod = "connect-src 'self' http://127.0.0.1:*;";
      if (!html.includes(prod)) {
        throw new Error(
          "index.html's connect-src changed; update devServerCsp",
        );
      }
      return html.replace(
        prod,
        "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;",
      );
    },
  };
}

export interface AppBuildOptions {
  /** The entry point that calls startApp(); becomes out/main/main.js. */
  mainEntry: string;
}

/**
 * The electron-vite config that builds the out/ layout electron/app.ts
 * expects: out/main/{main,queryWorker,autoTagWorker}.js, out/preload/preload.js
 * and out/renderer/. out/ is created in the working directory.
 */
export function appBuildConfig(options: AppBuildOptions): UserConfig {
  return {
    main: {
      plugins: [externalizeDepsPlugin({ include: runtimeDeps })],
      build: {
        outDir: "out/main",
        lib: {
          entry: {
            // Entry names become the output file names (main.js is
            // package.json's "main"; the workers are loaded via new Worker()
            // from electron/app.ts).
            main: options.mainEntry,
            queryWorker: fromRepo("electron/queryWorker.ts"),
            autoTagWorker: fromRepo("electron/autoTagWorker.ts"),
          },
        },
      },
    },
    preload: {
      // The renderer runs sandbox: true, so the preload script can only
      // require() a small whitelist of Electron modules — arbitrary
      // node_modules cannot be loaded at runtime. electron-log/preload must
      // therefore be inlined into the preload bundle, not externalized.
      resolve: { alias: { "@shared": fromRepo("shared") } },
      plugins: [
        externalizeDepsPlugin({
          include: runtimeDeps,
          exclude: ["electron-log"],
        }),
      ],
      build: {
        outDir: "out/preload",
        // Output as CommonJS (.js) because ESM (.mjs) preload can fail to load.
        lib: { entry: fromRepo("electron/preload.ts"), formats: ["cjs"] },
        rollupOptions: { output: { entryFileNames: "preload.js" } },
      },
    },
    renderer: {
      root: repoRoot,
      base: "./",
      plugins: [react(), tailwindcss(), devServerCsp()],
      resolve: {
        alias: { "@": fromRepo("src"), "@shared": fromRepo("shared") },
      },
      build: {
        // Absolute, because a relative outDir is resolved against `root`.
        outDir: resolve("out/renderer"),
        // Vite does not empty an outDir outside `root` unless told to.
        emptyOutDir: true,
        rollupOptions: { input: fromRepo("index.html") },
      },
    },
  };
}
