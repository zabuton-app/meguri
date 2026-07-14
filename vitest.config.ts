import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import type { Plugin } from "vite";

// The electron/ sources use NodeNext-style ".js" import specifiers that actually point at
// ".ts" files. Vite does not remap those by default, so do it here for the core tests.
function resolveTsJs(): Plugin {
  return {
    name: "resolve-ts-js",
    enforce: "pre",
    async resolveId(source, importer) {
      if (importer && source.startsWith(".") && source.endsWith(".js")) {
        const resolved = await this.resolve(
          source.replace(/\.js$/, ".ts"),
          importer,
          {
            skipSelf: true,
          },
        );
        if (resolved) return resolved;
      }
      return null;
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      {
        // Main-process / core logic. Run under Electron's Node (see the `test` npm script)
        // so the Electron-ABI better-sqlite3 binary loads against a real in-memory SQLite.
        plugins: [resolveTsJs()],
        test: {
          name: "core",
          environment: "node",
          include: ["electron/**/*.test.ts"],
        },
      },
      {
        // Renderer (React) logic in a DOM environment.
        plugins: [react()],
        resolve: {
          alias: { "@": resolve("src"), "@shared": resolve("shared") },
        },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
