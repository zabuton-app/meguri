// CSS theme files: which names count as a theme (only plain .css names, so a
// pick can never reach outside the folder), how they are named and listed,
// and that the folder watch sees a theme being added, saved and removed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const {
  isThemeFileName,
  listCssThemes,
  readCssTheme,
  themeNameFrom,
  watchCssThemes,
} = await import("../cssThemes.js");
const { loadConfig } = await import("../appConfig.js");
const { ChannelInputs } = await import("../../../shared/ipc/channels.js");

let dir = "";

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-css-themes-"));
  dir = path.join(userData, "themes");
  fs.mkdirSync(dir);
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("isThemeFileName", () => {
  it.each(["cyberpunk.css", "My Theme.css", "a.b.css"])("accepts %s", (f) =>
    expect(isThemeFileName(f)).toBe(true),
  );
  it.each([
    ".css",
    "theme.txt",
    "../x.css",
    "sub/x.css",
    "sub\\x.css",
    "x.css/",
  ])("rejects %s", (f) => expect(isThemeFileName(f)).toBe(false));
});

describe("themeNameFrom", () => {
  it("reads @name from the leading comment", () => {
    expect(themeNameFrom("/*\n * @name Neon Night\n */\na{}")).toBe(
      "Neon Night",
    );
  });
  it("reads it on a one-line comment", () => {
    expect(themeNameFrom("/* @name Neon */")).toBe("Neon");
  });
  it("ignores @name outside the leading comment", () => {
    expect(themeNameFrom("a{}\n/* @name Late */")).toBeNull();
  });
  it("is null without @name, or with an empty one", () => {
    expect(themeNameFrom("/* Just a comment */")).toBeNull();
    expect(themeNameFrom("/* @name   */")).toBeNull();
  });
  it("caps the length", () => {
    expect(themeNameFrom(`/* @name ${"x".repeat(200)} */`)).toHaveLength(64);
  });
});

describe("listCssThemes", () => {
  it("lists .css files named by @name or file name, sorted by name", () => {
    fs.writeFileSync(path.join(dir, "zeta.css"), "/* @name Alpha */");
    fs.writeFileSync(path.join(dir, "beta.css"), "a{}");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    fs.mkdirSync(path.join(dir, "folder.css"));
    expect(listCssThemes(dir)).toEqual([
      { file: "zeta.css", name: "Alpha" },
      { file: "beta.css", name: "beta" },
    ]);
  });

  it("names a large theme from its head without reading it whole", () => {
    const big = `/* @name Big */\n${"a{}".repeat(500_000)}`;
    fs.writeFileSync(path.join(dir, "big.css"), big);
    expect(listCssThemes(dir)).toEqual([{ file: "big.css", name: "Big" }]);
  });

  it("is empty when the folder does not exist", () => {
    expect(listCssThemes(path.join(userData, "missing"))).toEqual([]);
  });
});

describe("readCssTheme", () => {
  it("reads a theme file", () => {
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    expect(readCssTheme(dir, "a.css")).toBe("a{}");
  });

  it("refuses a name that would leave the folder", () => {
    fs.writeFileSync(path.join(userData, "outside.css"), "secret{}");
    expect(readCssTheme(dir, "../outside.css")).toBeNull();
  });

  it("is null for a missing file", () => {
    expect(readCssTheme(dir, "gone.css")).toBeNull();
  });
});

describe("watchCssThemes", () => {
  const waitForCall = (fn: ReturnType<typeof vi.fn>, times: number) =>
    vi.waitFor(
      () => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(times),
      { timeout: 2000 },
    );

  it("reports a theme being added, saved and removed", async () => {
    // Cleared before each step, so a late event from the previous one cannot
    // stand in for the step under test.
    const onChange = vi.fn();
    const stop = watchCssThemes(dir, onChange);
    const settle = () => new Promise((r) => setTimeout(r, 300));
    try {
      fs.writeFileSync(path.join(dir, "a.css"), "a{}");
      await waitForCall(onChange, 1);
      await settle();
      onChange.mockClear();
      fs.writeFileSync(path.join(dir, "a.css"), "b{}");
      await waitForCall(onChange, 1);
      await settle();
      onChange.mockClear();
      fs.rmSync(path.join(dir, "a.css"));
      await waitForCall(onChange, 1);
    } finally {
      stop();
    }
  });

  it("ignores files that are not themes", async () => {
    const onChange = vi.fn();
    const stop = watchCssThemes(dir, onChange);
    try {
      fs.writeFileSync(path.join(dir, "notes.txt"), "x");
      await new Promise((r) => setTimeout(r, 300));
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("creates the folder when it does not exist", () => {
    const missing = path.join(userData, "new-themes");
    const stop = watchCssThemes(missing, () => {});
    stop();
    expect(fs.statSync(missing).isDirectory()).toBe(true);
  });
});

describe("the stored pick", () => {
  const write = (config: unknown) =>
    fs.writeFileSync(
      path.join(userData, "config.json"),
      JSON.stringify(config),
    );

  it("is none for a config that never held it", () => {
    write({});
    expect(loadConfig().cssTheme).toBeNull();
  });

  it("keeps a plain file name and drops anything else", () => {
    write({ cssTheme: "cyberpunk.css" });
    expect(loadConfig().cssTheme).toBe("cyberpunk.css");
    write({ cssTheme: "../evil.css" });
    expect(loadConfig().cssTheme).toBeNull();
    write({ cssTheme: 3 });
    expect(loadConfig().cssTheme).toBeNull();
  });
});

describe("css_theme_select input", () => {
  const parse = (file: unknown) =>
    ChannelInputs.css_theme_select.safeParse({ file }).success;

  it("accepts a plain .css name or null", () => {
    expect(parse("cyberpunk.css")).toBe(true);
    expect(parse(null)).toBe(true);
  });

  it("rejects paths and other names", () => {
    for (const file of ["../x.css", "a/b.css", "a\\b.css", "x.txt", ""]) {
      expect(parse(file)).toBe(false);
    }
  });
});
