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
const { fileDetail, setFavorite, setRating } = await import("../queries.js");
const { addManualTag } = await import("../tags.js");
const { insertFile } = await import("./helpers.js");
const { Core } = await import("../index.js");

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

describe("removing a workspace and adding it again", () => {
  it("brings its metadata back, from the library every workspace shares", () => {
    const ws = new Workspaces();
    const { path: p } = ws.addRoot(root);
    const before = ws.byId(Workspaces.idFor(p))!;
    const id = insertFile(before.db, before.rootId, {
      relPath: "clip.mp4",
      root: p,
      contentHash: "h",
    });
    setFavorite(before.db, id, true);
    setRating(before.db, id, 4);
    addManualTag(before.db, id, "beach");
    const dataDir = before.dataDir;

    ws.remove(p);
    // Its file list and thumbnails go with it.
    expect(fs.existsSync(dataDir)).toBe(false);

    ws.addRoot(root);
    const after = ws.byId(Workspaces.idFor(p))!;
    // The scan finds the same content again.
    const again = insertFile(after.db, after.rootId, {
      relPath: "clip.mp4",
      root: p,
      contentHash: "h",
    });
    const detail = fileDetail(after.db, again);
    expect(detail).toMatchObject({ favorite: 1, rating: 4 });
    expect(detail?.tags.map((t) => t.name)).toEqual(["beach"]);
    ws.closeAll();
  });
});

describe("Workspaces.metadataCores", () => {
  it("opens only the workspaces the library has no record of", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-addroot-b-"));
    try {
      const first = new Workspaces();
      const { path: a } = first.addRoot(root);
      first.addRoot(other);
      // Both opened once: on the library, and recorded.
      first.allCores();
      first.closeAll();

      const ws = new Workspaces();
      ws.byId(Workspaces.idFor(a));
      const init = vi.spyOn(Core, "init");
      expect(ws.metadataCores().map(({ id }) => id)).toEqual([
        Workspaces.idFor(a),
      ]);
      expect(init).not.toHaveBeenCalled();
      init.mockRestore();
      ws.closeAll();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
