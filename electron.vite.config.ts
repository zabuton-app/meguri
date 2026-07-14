import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Build the main process (Node) / preload / renderer (React) with a single config.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      lib: { entry: resolve("electron/main.ts") },
    },
  },
  preload: {
    // The renderer runs sandbox: true, so the preload script can only require()
    // a small whitelist of Electron modules — arbitrary node_modules cannot be
    // loaded at runtime. electron-log/preload must therefore be inlined into
    // the preload bundle, not externalized.
    resolve: { alias: { "@shared": resolve("shared") } },
    plugins: [externalizeDepsPlugin({ exclude: ["electron-log"] })],
    build: {
      outDir: "out/preload",
      // Output as CommonJS (.js) because ESM (.mjs) preload can fail to load.
      lib: { entry: resolve("electron/preload.ts"), formats: ["cjs"] },
      rollupOptions: { output: { entryFileNames: "preload.js" } },
    },
  },
  renderer: {
    root: ".",
    base: "./",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": resolve("src"), "@shared": resolve("shared") },
    },
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: resolve("index.html") },
    },
  },
});
