// Tests for Workspaces.addRoot(): registering a folder reports whether it was
// new, which the add-workspace channels turn into "added" vs "already added".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// workspaces.ts reads/writes <userData>/config.json via appConfig.ts; point that
// at a throwaway directory so each test gets a pristine config.
let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");

let root = "";

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-addroot-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-addroot-root-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Workspaces.addRoot", () => {
  it("reports a folder registered for the first time as added", () => {
    const ws = new Workspaces();
    const first = ws.addRoot(root);
    expect(first).toEqual({ path: fs.realpathSync(root), added: true });
  });

  it("reports the same folder again as not added, with the stored path", () => {
    const ws = new Workspaces();
    const first = ws.addRoot(root);
    expect(ws.addRoot(root)).toEqual({ path: first.path, added: false });
    expect(ws.list().filter((w) => w.path === first.path)).toHaveLength(1);
  });

  it("keeps add() returning the stored path", () => {
    const ws = new Workspaces();
    const np = ws.add(root);
    expect(ws.add(root)).toBe(np);
  });
});

describe("Workspaces persistence", () => {
  // Settings written through updateConfig() after the Workspaces snapshot was
  // taken must survive a workspace write (regression: switching workspaces
  // reverted custom CSS, the CSS theme and the logo to their startup values).
  it("keeps settings it does not own when it writes config.json", async () => {
    const { loadConfig, updateConfig } = await import("../appConfig.js");
    const ws = new Workspaces();
    updateConfig((c) => ({
      ...c,
      customCss: { ...c.customCss, enabled: true },
      cssTheme: "dark.css",
      update: { ...c.update, autoCheck: false },
    }));

    const added = ws.addRoot(root);
    ws.setActive(added.path);

    const saved = loadConfig();
    expect(saved.activePath).toBe(added.path);
    expect(saved.roots).toContain(added.path);
    expect(saved.customCss.enabled).toBe(true);
    expect(saved.cssTheme).toBe("dark.css");
    expect(saved.update.autoCheck).toBe(false);
  });
});
