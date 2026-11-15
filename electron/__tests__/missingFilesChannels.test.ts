// The missing-files channels (#277) through their real handlers: what a
// removal takes with it, and that a workspace being scanned is left alone
// (mid-rebuild, every file on disk reads as missing).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const { registerFileHandlers } = await import("../ipc/files.js");
const { QueryExecutor } = await import("../core/queryExec.js");
const { WATCH_LATER_ID } = await import("../../shared/workspaceIds.js");
const { insertFile } = await import("../core/__tests__/helpers.js");
const { setRendererIndex } = await import("../core/appUrl.js");
type Core = import("../core/index.js").Core;
type IpcContext = import("../ipc/context.js").IpcContext;
type QueryRequest = import("../core/queryExec.js").QueryRequest;

const rendererIndex = path.join(os.tmpdir(), "meguri-app", "index.html");
setRendererIndex(rendererIndex);
const fromApp = { senderFrame: { url: pathToFileURL(rendererIndex).href } };
const invoke = (channel: string, payload?: unknown) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(fromApp, payload);
};

let root = "";
let ws: InstanceType<typeof Workspaces>;
let core: Core;
let exec: InstanceType<typeof QueryExecutor>;
let gone = 0;
let scanning = false;
const emitted: string[] = [];

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-missing-"));
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "meguri-r-")));
  handlers.clear();
  emitted.length = 0;
  scanning = false;
  ws = new Workspaces();
  ws.add(root);
  ws.setActive(root);
  core = ws.active()!;
  insertFile(core.db, core.rootId, { relPath: "here.mp4", root });
  gone = insertFile(core.db, core.rootId, { relPath: "gone.mp4", root });
  core.db.prepare("UPDATE files SET deleted_at = 100 WHERE id = ?").run(gone);
  ws.addToCollection(WATCH_LATER_ID, ws.activeId!, gone);
  fs.mkdirSync(core.thumbsDir(), { recursive: true });
  fs.writeFileSync(path.join(core.thumbsDir(), `${gone}.webp`), "webp");
  exec = new QueryExecutor(() => {});
  const ctx = {
    ws,
    queryClient: {
      run: (req: QueryRequest) => Promise.resolve(exec.run(req)),
      invalidateCaches: () => Promise.resolve(),
    },
    positions: { flush: () => {} },
    emit: (channel: string) => emitted.push(channel),
    scans: { isScanning: () => scanning },
  } as unknown as IpcContext;
  registerFileHandlers(ctx);
});

afterEach(() => {
  exec.closeAll();
  ws.closeAll();
  for (const dir of [userData, root]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const target = () => ({
  targets: [{ workspaceId: ws.activeId, fileIds: [gone] }],
});
const watchLater = () =>
  ws.collections().find((c) => c.id === WATCH_LATER_ID)?.items ?? [];

describe("missing files channels", () => {
  it("lists the file gone from disk", async () => {
    const list = (await invoke("missing_files_list")) as {
      items: { id: number; relPath: string }[];
      total: number;
      scanning: boolean;
    };
    expect(list.items.map((r) => r.relPath)).toEqual(["gone.mp4"]);
    expect(list).toMatchObject({ total: 1, scanning: false });
  });

  it("removes the row, its thumbnail and its collection entries", async () => {
    expect(await invoke("missing_files_purge", target())).toEqual({
      removed: 1,
    });
    expect(
      core.db.prepare("SELECT 1 FROM files WHERE id = ?").get(gone),
    ).toBeUndefined();
    expect(fs.existsSync(path.join(core.thumbsDir(), `${gone}.webp`))).toBe(
      false,
    );
    expect(watchLater()).toEqual([]);
    expect(emitted).toContain("workspace:changed");
  });

  it("leaves a workspace being scanned out of the list and the removal", async () => {
    scanning = true;
    const list = (await invoke("missing_files_list")) as {
      items: unknown[];
      scanning: boolean;
    };
    expect(list).toMatchObject({ items: [], scanning: true });

    expect(await invoke("missing_files_purge", target())).toEqual({
      removed: 0,
    });
    expect(
      core.db.prepare("SELECT 1 FROM files WHERE id = ?").get(gone),
    ).toBeDefined();
    expect(watchLater()).toHaveLength(1);
  });
});
