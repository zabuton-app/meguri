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

  it("reads a keyword written as one tag with aliases as terms adding that tag", () => {
    write({
      autoTag: {
        ...defaultAutoTagConfig(),
        keywords: [
          { id: "k1", tag: "Yoga", aliases: ["ヨガ", "stretch"], mode: "word" },
          {
            id: "k2",
            terms: ["Trip"],
            tags: ["Trip", "Journey"],
            mode: "word",
          },
        ],
      },
    });
    expect(loadConfig().autoTag.keywords).toEqual([
      {
        id: "k1",
        terms: ["Yoga", "ヨガ", "stretch"],
        tags: ["Yoga"],
        mode: "word",
      },
      { id: "k2", terms: ["Trip"], tags: ["Trip", "Journey"], mode: "word" },
    ]);
  });

  it("keeps an old entry with as many aliases as were allowed, short of its last", () => {
    // The old shape held a tag plus 32 aliases: one more term than there is
    // room for. The aliases that are not an array, or a tag that is not a
    // string, are no entry at all.
    const aliases = Array.from({ length: 32 }, (_, i) => `alias${i}`);
    write({
      autoTag: {
        ...defaultAutoTagConfig(),
        keywords: [
          { id: "k1", tag: "Yoga", aliases, mode: "word" },
          { id: "k2", tag: "Trip", aliases: "trip", mode: "word" },
          { id: "k3", tag: 7, aliases: [], mode: "word" },
        ],
      },
    });
    expect(loadConfig().autoTag.keywords).toEqual([
      {
        id: "k1",
        terms: ["Yoga", ...aliases.slice(0, 31)],
        tags: ["Yoga"],
        mode: "word",
      },
      { id: "k2", terms: ["Trip"], tags: ["Trip"], mode: "word" },
    ]);
  });

  it("reads a configuration written before folder rules as having none", () => {
    const before: Record<string, unknown> = { ...defaultAutoTagConfig() };
    delete before.folders;
    write({ autoTag: before });
    expect(loadConfig().autoTag.folders).toEqual([]);
    // And one rule that no longer validates does not take the others with it.
    const good = {
      id: "f1",
      workspaceId: "ws",
      folder: "Trips",
      tags: ["Trip"],
      enabled: true,
    };
    write({
      autoTag: {
        ...before,
        folders: [good, { ...good, id: "f2", folder: "../x" }],
      },
    });
    expect(loadConfig().autoTag.folders).toEqual([good]);
  });
});
