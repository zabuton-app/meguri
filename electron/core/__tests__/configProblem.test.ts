// A config.json that cannot be used is never replaced by the defaults (#261):
// an unparsable one is moved aside, an unreadable one is not imported. Once
// imported into the library (#325), it is left alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

// appConfig keeps what went wrong for the session, so each test gets a fresh
// copy of the module.
async function freshConfig() {
  vi.resetModules();
  return await import("../appConfig.js");
}

const configFile = () => path.join(userData, "config.json");
const asides = () =>
  fs.readdirSync(userData).filter((n) => n.startsWith("config.json.corrupt-"));

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-config-problem-"));
});

afterEach(() => {
  fs.chmodSync(userData, 0o755);
  if (fs.existsSync(configFile())) fs.chmodSync(configFile(), 0o644);
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("loading config.json", () => {
  it("starts from the defaults without a problem on first launch", async () => {
    const c = await freshConfig();
    expect(c.loadConfig().roots).toEqual([]);
    expect(c.configLoadProblem()).toBeNull();
    c.updateConfig((cfg) => ({ ...cfg, roots: ["/media"] }));
    expect(c.loadConfig().roots).toEqual(["/media"]);
  });

  it("moves an unparsable file aside before the defaults are saved", async () => {
    const broken = '{"roots": ["/media"], "collections": [';
    fs.writeFileSync(configFile(), broken);
    const c = await freshConfig();

    expect(c.loadConfig().roots).toEqual([]);
    expect(c.configLoadProblem()).toBe("moved-aside");
    const [aside] = asides();
    expect(aside).toMatch(/^config\.json\.corrupt-\d{8}-\d{6}$/);
    expect(fs.readFileSync(path.join(userData, aside), "utf8")).toBe(broken);

    // Saving goes on, in the library; the copy is left alone.
    c.updateConfig((cfg) => ({ ...cfg, roots: ["/other"] }));
    expect(c.loadConfig().roots).toEqual(["/other"]);
    expect(asides()).toEqual([aside]);
  });

  it("treats JSON that is not an object as damaged", async () => {
    fs.writeFileSync(configFile(), "null");
    const c = await freshConfig();
    c.loadConfig();
    expect(c.configLoadProblem()).toBe("moved-aside");
    expect(asides()).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "does not write over a file it cannot read",
    async () => {
      const stored = JSON.stringify({ roots: ["/media"] });
      fs.writeFileSync(configFile(), stored);
      fs.chmodSync(configFile(), 0o000);
      const c = await freshConfig();

      expect(c.loadConfig().roots).toEqual([]);
      expect(c.configLoadProblem()).toBe("unreadable");
      c.updateConfig((cfg) => ({ ...cfg, roots: [] }));

      fs.chmodSync(configFile(), 0o644);
      expect(fs.readFileSync(configFile(), "utf8")).toBe(stored);
      expect(asides()).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "does not write over an unparsable file it cannot move aside",
    async () => {
      const broken = '{"roots": ["/media"],';
      fs.writeFileSync(configFile(), broken);
      fs.chmodSync(userData, 0o555); // no rename in the folder
      const c = await freshConfig();

      expect(c.loadConfig().roots).toEqual([]);
      expect(c.configLoadProblem()).toBe("unreadable");
      c.updateConfig((cfg) => ({ ...cfg, roots: ["/other"] }));
      c.loadConfig(); // no second attempt either

      fs.chmodSync(userData, 0o755);
      expect(fs.readFileSync(configFile(), "utf8")).toBe(broken);
      expect(asides()).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "imports a file it could not read on a later launch, once it can",
    async () => {
      fs.writeFileSync(configFile(), JSON.stringify({ roots: ["/media"] }));
      fs.chmodSync(configFile(), 0o000);
      (await freshConfig()).loadConfig();
      fs.chmodSync(configFile(), 0o644);

      const c = await freshConfig();
      expect(c.loadConfig().roots).toEqual(["/media"]);
      expect(c.configLoadProblem()).toBeNull();
    },
  );
});

describe("after config.json is imported", () => {
  it("keeps the file as it was and never reads or writes it again", async () => {
    const stored = JSON.stringify({ roots: ["/media"], logo: "default" });
    fs.writeFileSync(configFile(), stored);
    const c = await freshConfig();
    expect(c.loadConfig().roots).toEqual(["/media"]);
    c.updateConfig((cfg) => ({ ...cfg, activePath: "/media" }));
    expect(fs.readFileSync(configFile(), "utf8")).toBe(stored);

    // Changed by an older version of the app, or caught half-written.
    fs.writeFileSync(configFile(), '{"roots": [');
    const again = await freshConfig();
    expect(again.loadConfig()).toMatchObject({
      roots: ["/media"],
      activePath: "/media",
    });
    expect(again.configLoadProblem()).toBeNull();
    expect(asides()).toEqual([]);
  });
});

describe("a library that cannot be opened", () => {
  it("runs on the defaults and writes nothing", async () => {
    fs.writeFileSync(configFile(), JSON.stringify({ roots: ["/media"] }));
    fs.mkdirSync(path.join(userData, "library.sqlite")); // not a database
    const c = await freshConfig();

    expect(c.loadConfig().roots).toEqual([]);
    expect(c.configLoadProblem()).toBe("unreadable");
    c.updateConfig((cfg) => ({ ...cfg, roots: ["/other"] }));
    expect(c.loadConfig().roots).toEqual([]);
  });
});
