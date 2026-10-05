// What is read back for the auto-tagging configuration: the defaults for a
// config that never held it, and a stored one exactly as it was stored — the
// defaults changing must not reach into what a user already has.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { loadConfig } = await import("../appConfig.js");
const { defaultAutoTagConfig, defaultRules } =
  await import("../../../shared/autoTag.js");

const write = (config: unknown) =>
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify(config));

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-autotag-config-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("the stored auto-tagging configuration", () => {
  it("starts from the defaults, with no rule switched on", () => {
    write({});
    const { autoTag } = loadConfig();
    expect(autoTag).toEqual(defaultAutoTagConfig());
    expect(autoTag.rules.some((rule) => rule.enabled)).toBe(false);
  });

  it("keeps the rules a user has as they are: switched on, edited, in their order", () => {
    // As a config written while the built-in rules still shipped switched on.
    const [prefix, square, ...rest] = defaultRules();
    const stored = {
      ...defaultAutoTagConfig(),
      applyOnScan: true,
      rules: [
        { ...square, enabled: true },
        { ...prefix, enabled: true, exclude: "IMG" },
        ...rest,
      ],
    };
    write({ autoTag: stored });
    expect(loadConfig().autoTag).toEqual(stored);
  });
});
