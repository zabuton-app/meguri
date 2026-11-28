// The note template a new note starts from (#345), kept with the settings in
// the library's app_settings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_MAX_MARKDOWN } from "../../../shared/note.js";
import { writeStoredSettings } from "./storedSettings.js";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

// appConfig keeps the library it opened for the session, so each test gets a
// fresh copy of the module.
async function freshConfig() {
  vi.resetModules();
  return await import("../appConfig.js");
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-note-template-"));
});

afterEach(() => {
  const legacy = path.join(userData, "config.json");
  if (fs.existsSync(legacy)) fs.chmodSync(legacy, 0o644);
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("the note template setting", () => {
  it("has no template by default", async () => {
    const c = await freshConfig();
    expect(c.loadConfig().noteTemplate).toBe("");
  });

  it("keeps the template it was given", async () => {
    const template = "## Source\n\n## Licence";
    const c = await freshConfig();
    c.updateConfig((cfg) => ({ ...cfg, noteTemplate: template }));
    const again = await freshConfig();
    expect(again.loadConfig().noteTemplate).toBe(template);
  });

  it("stores what it is given as a note would be, and returns it", async () => {
    const c = await freshConfig();
    expect(c.saveNoteTemplate("## Source")).toBe("## Source");
    expect(c.loadConfig().noteTemplate).toBe("## Source");
    // Only whitespace is no template, as it is no note.
    expect(c.saveNoteTemplate("  \n ")).toBe("");
    expect(c.loadConfig().noteTemplate).toBe("");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "throws when the template could not be stored, rather than report it saved",
    async () => {
      // An unreadable config.json at startup leaves the settings unwritable
      // for the session (see configProblem.test.ts): every write is lost.
      const legacy = path.join(userData, "config.json");
      fs.writeFileSync(legacy, JSON.stringify({ roots: [] }));
      fs.chmodSync(legacy, 0o000);
      const c = await freshConfig();
      expect(() => c.saveNoteTemplate("## Source")).toThrow(
        /note template could not be saved/,
      );
      expect(c.loadConfig().noteTemplate).toBe("");
    },
  );

  it("falls back to none for a stored value that is not a string or is too long", async () => {
    writeStoredSettings(userData, { noteTemplate: 42, roots: ["/media"] });
    let c = await freshConfig();
    expect(c.loadConfig().noteTemplate).toBe("");
    expect(c.loadConfig().roots).toEqual(["/media"]);

    writeStoredSettings(userData, {
      noteTemplate: "x".repeat(NOTE_MAX_MARKDOWN + 1),
    });
    c = await freshConfig();
    expect(c.loadConfig().noteTemplate).toBe("");
  });
});
