// The worker threads (queryWorker, autoTagWorker) cannot load the electron
// module: in a packaged build it does not resolve there, and the worker dies
// on start. QueryWorkerClient then rejects what was in flight and, after a few
// crashes, runs every query on the main thread, so the first lists at startup
// come back as errors. Nothing a worker imports may reach electron, which
// usually happens through the electron-log logger (core/logger.ts).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ELECTRON_ONLY = ["electron", "electron-log"];
const ELECTRON_DIR = path.resolve(__dirname, "..");

/** Value imports and re-exports of a module (`import type` and `export type` are erased). */
function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const specs: string[] = [];
  const re =
    /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) specs.push(m[1]);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec).replace(/\.js$/, "");
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Each import chain from `entry` that ends in an electron-only package. */
function electronChains(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const here = [...chain, path.relative(ELECTRON_DIR, file)];
      if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (next) walk(next, here);
      } else if (
        ELECTRON_ONLY.some((p) => spec === p || spec.startsWith(`${p}/`))
      ) {
        found.push([...here, spec].join(" -> "));
      }
    }
  };
  walk(entry, []);
  return found;
}

describe("worker thread imports", () => {
  it.each(["queryWorker.ts", "autoTagWorker.ts"])(
    "%s does not reach the electron module",
    (entry) => {
      expect(electronChains(path.join(ELECTRON_DIR, entry))).toEqual([]);
    },
  );
});
