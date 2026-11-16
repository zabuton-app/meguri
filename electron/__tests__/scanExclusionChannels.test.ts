// The scan exclusion channels (#282) through their real handlers: a saved
// pattern hides what it covers in every workspace at once, without a scan, and
// a pattern that does not compile is refused.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) =>
      handlers.set(channel, fn),
  },
  shell: {},
}));

const { Workspaces } = await import("../core/workspaces.js");
const { registerScanHandlers } = await import("../ipc/scan.js");
const { WorkspacePasses } = await import("../core/workspacePasses.js");
const { deriveAutoTagsInProcess } = await import("../core/autoTagDeriver.js");
const { insertFile } = await import("../core/__tests__/helpers.js");
const { setRendererIndex } = await import("../core/appUrl.js");
const { loadConfig } = await import("../core/appConfig.js");
const { countMissingFiles } = await import("../core/queries.js");
const { writeStoredSettings } =
  await import("../core/__tests__/storedSettings.js");
type IpcContext = import("../ipc/context.js").IpcContext;

const rendererIndex = path.join(os.tmpdir(), "meguri-app", "index.html");
setRendererIndex(rendererIndex);
const fromApp = { senderFrame: { url: pathToFileURL(rendererIndex).href } };
const invoke = (channel: string, payload?: unknown) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(fromApp, payload);
};

let roots: string[] = [];
let ws: InstanceType<typeof Workspaces>;
const invalidated = vi.fn(() => Promise.resolve());

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-exclusions-"));
  roots = [0, 1].map(() =>
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "meguri-r-"))),
  );
  handlers.clear();
  invalidated.mockClear();
  ws = new Workspaces();
  for (const root of roots) {
    ws.add(root);
    const core = ws.allCores().find((c) => c.core.root === root)!.core;
    for (const relPath of ["cache/a.mp4", "keep/b.mp4"]) {
      insertFile(core.db, core.rootId, {
        relPath: relPath.split("/").join(path.sep),
        root,
      });
    }
  }
  registerScanHandlers({
    ws,
    queryClient: { invalidateCaches: invalidated },
    passes: new WorkspacePasses(),
    deriveAutoTags: deriveAutoTagsInProcess,
    scans: {},
  } as unknown as IpcContext);
});

afterEach(() => {
  ws.closeAll();
  for (const dir of [userData, ...roots]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const visible = () =>
  ws
    .allCores()
    .map(({ core }) =>
      (
        core.db
          .prepare(
            "SELECT rel_path FROM files WHERE deleted_at IS NULL ORDER BY rel_path",
          )
          .pluck()
          .all() as string[]
      ).map((p) => p.split(path.sep).join("/")),
    );

describe("scan exclusion channels", () => {
  it("save the patterns and hide what they cover in every workspace", async () => {
    await expect(
      invoke("scan_exclusions_set_patterns", { patterns: ["^cache/$"] }),
    ).resolves.toEqual({ patterns: ["^cache/$"] });

    expect(loadConfig().scanExclusions.patterns).toEqual(["^cache/$"]);
    expect(visible()).toEqual([["keep/b.mp4"], ["keep/b.mp4"]]);
    // Hidden, not gone.
    for (const { core } of ws.allCores())
      expect(countMissingFiles(core.db)).toBe(0);
    expect(invalidated).toHaveBeenCalled();
  });

  it("refuse a pattern that does not compile, saving nothing", async () => {
    await expect(
      invoke("scan_exclusions_set_patterns", { patterns: ["^ok$", "("] }),
    ).rejects.toThrow();

    expect(loadConfig().scanExclusions.patterns).toEqual([]);
    expect(visible()).toEqual([
      ["cache/a.mp4", "keep/b.mp4"],
      ["cache/a.mp4", "keep/b.mp4"],
    ]);
  });

  it("fail a save that was not written, hiding nothing", async () => {
    loadConfig();
    // The settings table refuses every write.
    const raw = new Database(path.join(userData, "library.sqlite"));
    for (const op of ["INSERT", "UPDATE"])
      raw.exec(
        `CREATE TRIGGER refuse_${op} BEFORE ${op} ON app_settings BEGIN SELECT RAISE(ABORT, 'refused'); END`,
      );
    raw.close();

    await expect(
      invoke("scan_exclusions_set_patterns", { patterns: ["^cache/$"] }),
    ).rejects.toThrow(/could not be saved/);
    expect(visible()).toEqual([
      ["cache/a.mp4", "keep/b.mp4"],
      ["cache/a.mp4", "keep/b.mp4"],
    ]);
  });

  it("report a save that went through when what it covers cannot be hidden yet", async () => {
    registerScanHandlers({
      ws,
      queryClient: { invalidateCaches: invalidated },
      passes: new WorkspacePasses(),
      deriveAutoTags: () => Promise.reject(new Error("worker down")),
      scans: {},
    } as unknown as IpcContext);

    await expect(
      invoke("scan_exclusions_set_patterns", { patterns: ["^cache/$"] }),
    ).resolves.toEqual({ patterns: ["^cache/$"] });

    // The next scan applies it.
    expect(loadConfig().scanExclusions.patterns).toEqual(["^cache/$"]);
    expect(visible()).toEqual([
      ["cache/a.mp4", "keep/b.mp4"],
      ["cache/a.mp4", "keep/b.mp4"],
    ]);
  });

  it("read back what is stored, entry by entry", async () => {
    writeStoredSettings(userData, {
      scanExclusions: {
        patterns: ["^a/$", 3, "", "^a/$"],
        folders: { w: ["ok/dir", "../up", 5], other: "nope" },
      },
    });

    await expect(invoke("scan_exclusions_get")).resolves.toEqual({
      patterns: ["^a/$"],
    });
    expect(loadConfig().scanExclusions.folders).toEqual({ w: ["ok/dir"] });
  });

  describe("excluded folders", () => {
    const ids = () => ws.allCores().map(({ id }) => id);

    it("save a folder and hide what it holds in that workspace only", async () => {
      const [first] = ids();
      fs.mkdirSync(path.join(roots[0], "cache"));

      await expect(
        invoke("scan_exclusions_add_folder", {
          workspaceId: first,
          path: "cache",
        }),
      ).resolves.toEqual({ folders: [{ path: "cache", found: true }] });
      // Again: kept once.
      await invoke("scan_exclusions_add_folder", {
        workspaceId: first,
        path: "cache",
      });

      expect(loadConfig().scanExclusions.folders).toEqual({
        [first]: ["cache"],
      });
      expect(visible()).toEqual([
        ["keep/b.mp4"],
        ["cache/a.mp4", "keep/b.mp4"],
      ]);
      for (const { core } of ws.allCores())
        expect(countMissingFiles(core.db)).toBe(0);
      expect(invalidated).toHaveBeenCalled();
    });

    it("say which folders are not on disk any more", async () => {
      const [first] = ids();
      fs.mkdirSync(path.join(roots[0], "keep"));
      for (const folder of ["keep", "cache"])
        await invoke("scan_exclusions_add_folder", {
          workspaceId: first,
          path: folder,
        });

      await expect(
        invoke("scan_exclusions_folders", { workspaceId: first }),
      ).resolves.toEqual({
        folders: [
          { path: "keep", found: true },
          { path: "cache", found: false },
        ],
      });
    });

    it("take folders off the list, leaving their files hidden until a scan", async () => {
      const [first] = ids();
      for (const folder of ["cache", "keep"])
        await invoke("scan_exclusions_add_folder", {
          workspaceId: first,
          path: folder,
        });

      await expect(
        invoke("scan_exclusions_remove_folders", {
          workspaceId: first,
          paths: ["cache"],
        }),
      ).resolves.toEqual({ folders: [{ path: "keep", found: false }] });
      expect(visible()[0]).toEqual([]);

      await invoke("scan_exclusions_remove_folders", {
        workspaceId: first,
        paths: ["keep"],
      });
      expect(loadConfig().scanExclusions.folders).toEqual({});
    });

    it("refuse the workspace root and an unknown workspace", async () => {
      await expect(
        invoke("scan_exclusions_add_folder", {
          workspaceId: ids()[0],
          path: "",
        }),
      ).rejects.toThrow();
      await expect(
        invoke("scan_exclusions_add_folder", {
          workspaceId: "nope",
          path: "cache",
        }),
      ).rejects.toThrow();
      expect(loadConfig().scanExclusions.folders).toEqual({});
    });
  });
});
