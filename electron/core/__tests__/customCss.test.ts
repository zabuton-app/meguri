// custom.css on disk: the template never overwrites the user's file, a
// missing file reads as null, and the watcher sees saves, including the
// write-new-then-rename kind many editors do, and deletion.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const {
  CUSTOM_CSS_FILE,
  CUSTOM_CSS_TEMPLATE,
  ensureCustomCssFile,
  readCustomCss,
  watchCustomCss,
} = await import("../customCss.js");
const { loadConfig, updateConfig } = await import("../appConfig.js");

let file = "";

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-custom-css-"));
  file = path.join(userData, CUSTOM_CSS_FILE);
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("custom.css", () => {
  it("reads as null while the file does not exist", () => {
    expect(readCustomCss(file)).toBeNull();
  });

  it("creates the file from the template", () => {
    ensureCustomCssFile(file);
    expect(readCustomCss(file)).toBe(CUSTOM_CSS_TEMPLATE);
  });

  it("never overwrites a file the user already has", () => {
    fs.writeFileSync(file, "a{color:red}");
    ensureCustomCssFile(file);
    expect(readCustomCss(file)).toBe("a{color:red}");
  });

  it("creates the directory when it is missing", () => {
    const nested = path.join(userData, "sub", CUSTOM_CSS_FILE);
    ensureCustomCssFile(nested);
    expect(readCustomCss(nested)).toBe(CUSTOM_CSS_TEMPLATE);
  });
});

describe("watchCustomCss", () => {
  // At least n calls: a loaded machine can split one save into two
  // debounced bursts, so an exact count would be flaky.
  const waitForCall = (fn: ReturnType<typeof vi.fn>, times: number) =>
    vi.waitFor(
      () => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(times),
      { timeout: 2000 },
    );

  it("reports a save, a rename over the file and a deletion", async () => {
    fs.writeFileSync(file, "a{}");
    const onChange = vi.fn();
    const stop = watchCustomCss(file, onChange);
    try {
      fs.writeFileSync(file, "b{}");
      await waitForCall(onChange, 1);

      const tmp = path.join(userData, "custom.css.tmp");
      fs.writeFileSync(tmp, "c{}");
      fs.renameSync(tmp, file);
      await waitForCall(onChange, 2);
      expect(readCustomCss(file)).toBe("c{}");

      fs.rmSync(file);
      await waitForCall(onChange, 3);
    } finally {
      stop();
    }
  });

  it("ignores other files in the same directory", async () => {
    const onChange = vi.fn();
    const stop = watchCustomCss(file, onChange);
    try {
      fs.writeFileSync(path.join(userData, "config.json"), "{}");
      await new Promise((r) => setTimeout(r, 300));
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("stops reporting once stopped", async () => {
    const onChange = vi.fn();
    const stop = watchCustomCss(file, onChange);
    stop();
    fs.writeFileSync(file, "a{}");
    await new Promise((r) => setTimeout(r, 300));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the stored switch", () => {
  it("is off for a config that never held it", () => {
    fs.writeFileSync(path.join(userData, "config.json"), "{}");
    expect(loadConfig().customCss).toEqual({ enabled: false });
  });

  it("keeps what was saved", () => {
    updateConfig((c) => ({ ...c, customCss: { enabled: true } }));
    expect(loadConfig().customCss).toEqual({ enabled: true });
  });

  it("treats anything but true as off", () => {
    fs.writeFileSync(
      path.join(userData, "config.json"),
      JSON.stringify({ customCss: { enabled: "yes" } }),
    );
    expect(loadConfig().customCss).toEqual({ enabled: false });
  });
});
