import type { UserConfig } from "electron-vite";
import { externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { normalizePath, searchForWorkspaceRoot, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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

// index.html's module script. A build with its own renderer entry loads that
// file in its place.
const DEFAULT_RENDERER_ENTRY = "/src/main.tsx";

/**
 * Loads `entry` in place of index.html's script. The build resolves the
 * script's src through the plugins; the dev server serves it by URL instead,
 * so there the src itself is rewritten to the file, and the workspace root of
 * the building project is opened to it (by default it serves only this
 * repository).
 *
 * Tailwind scans the Vite root (this repository) for class names, so the
 * entry's directory is added to the stylesheet as a source too; otherwise
 * classes used only in the app's own files would not be generated. This has
 * to run before Tailwind's transform, so it goes before tailwindcss() in the
 * plugin list.
 */
function rendererEntry(entry: string): Plugin {
  // Vite's module ids use forward slashes on every platform.
  const entryId = normalizePath(entry);
  const stylesheet = normalizePath(fromRepo("src/styles.css"));
  const source = normalizePath(relative(dirname(stylesheet), dirname(entry)));
  return {
    name: "renderer-entry",
    enforce: "pre",
    config: () => ({
      server: {
        fs: {
          allow: [
            searchForWorkspaceRoot(repoRoot),
            searchForWorkspaceRoot(process.cwd()),
          ],
        },
      },
    }),
    resolveId(id) {
      return id === DEFAULT_RENDERER_ENTRY ? entryId : null;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, { server }) {
        if (!server) return html;
        const src = `src="${DEFAULT_RENDERER_ENTRY}"`;
        if (!html.includes(src)) {
          throw new Error(
            "index.html's entry script changed; update rendererEntry",
          );
        }
        // /@fs/ + an absolute path: /@fs/home/… on POSIX, /@fs/C:/… on Windows.
        return html.replace(src, `src="/@fs/${entryId.replace(/^\//, "")}"`);
      },
    },
    transform(code, id) {
      if (id.split("?", 1)[0] !== stylesheet) return null;
      return `${code}\n@source ${JSON.stringify(source)};\n`;
    },
  };
}

export interface AppBuildOptions {
  /** The entry point that calls startApp(); becomes out/main/main.js. */
  mainEntry: string;
  /**
   * The renderer's entry point, which calls renderApp(). Defaults to
   * Meguri's src/main.tsx.
   */
  rendererEntry?: string;
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
        rolldownOptions: { output: { entryFileNames: "preload.js" } },
      },
    },
    renderer: {
      root: repoRoot,
      base: "./",
      plugins: [
        ...(options.rendererEntry
          ? [rendererEntry(options.rendererEntry)]
          : []),
        react(),
        tailwindcss(),
        devServerCsp(),
      ],
      resolve: {
        alias: { "@": fromRepo("src"), "@shared": fromRepo("shared") },
      },
      build: {
        // Absolute, because a relative outDir is resolved against `root`.
        outDir: resolve("out/renderer"),
        // Vite does not empty an outDir outside `root` unless told to.
        emptyOutDir: true,
        rolldownOptions: { input: fromRepo("index.html") },
      },
    },
  };
}
