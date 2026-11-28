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
