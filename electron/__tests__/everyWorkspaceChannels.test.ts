// The channels that write every workspace's metadata at once (tag rename and
// delete, history clear), driven through their real handlers over two
// workspaces that share one library, with workspace A in view.
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
const { registerTagHandlers } = await import("../ipc/tags.js");
const { registerFileHandlers } = await import("../ipc/files.js");
const q = await import("../core/queries.js");
const tags = await import("../core/tags.js");
const { insertFile, LEGACY_METADATA_DDL } =
  await import("../core/__tests__/helpers.js");
const { openDb, usesOwnMetadata } = await import("../core/db.js");
const paths = await import("../core/paths.js");
const { setRendererIndex } = await import("../core/appUrl.js");
type Core = import("../core/index.js").Core;
type IpcContext = import("../ipc/context.js").IpcContext;

// handle() answers the app's own page only, so the calls come from there.
const rendererIndex = path.join(os.tmpdir(), "meguri-app", "index.html");
setRendererIndex(rendererIndex);
const fromApp = { senderFrame: { url: pathToFileURL(rendererIndex).href } };

const invoke = (channel: string, payload?: unknown) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(fromApp, payload);
};

let rootA = "";
let rootB = "";
let ws: InstanceType<typeof Workspaces>;
let a: Core;
let b: Core;
let inA = 0;
let inB = 0;

/**
 * Leave B on its own metadata tables, as a workspace whose merge into the
 * library cannot run yet: its database from before the library, and its
 * backup path taken by a directory, so the copy cannot be written.
 */
function keepOnOwnTables(root: string): void {
  const dataDir = paths.dataDirForRoot(root);
  fs.mkdirSync(path.join(paths.backupDbPathForDataDir(dataDir), "taken"), {
    recursive: true,
  });
  const db = openDb(paths.dbPathForDataDir(dataDir), paths.libraryDbPath());
  db.exec(LEGACY_METADATA_DDL);
  db.close();
}

function setUp(bOnOwnTables: boolean): void {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-every-"));
  rootA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "meguri-a-")));
  rootB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "meguri-b-")));
  if (bOnOwnTables) keepOnOwnTables(rootB);
  handlers.clear();
  ws = new Workspaces();
  ws.add(rootB);
  ws.add(rootA);
  ws.setActive(rootA);
  a = ws.active()!;
  b = ws.byId(Workspaces.idFor(rootB))!;
  // The same content in both.
  inA = insertFile(a.db, a.rootId, {
    relPath: "trip.mp4",
    root: rootA,
    contentHash: "h",
  });
  inB = insertFile(b.db, b.rootId, {
    relPath: "clip.mp4",
    root: rootB,
    contentHash: "h",
  });
  tags.syncFts(a.db, inA);
  tags.syncFts(b.db, inB);
  const ctx = {
    ws,
    queryClient: { invalidateCaches: () => Promise.resolve() },
    positions: { flush: () => {} },
    emit: () => {},
  } as unknown as IpcContext;
  registerTagHandlers(ctx);
  registerFileHandlers(ctx);
}

afterEach(() => {
  ws.closeAll();
  for (const dir of [userData, rootA, rootB]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const matches = (core: Core, text: string) =>
  q.searchFiles(core.db, { q: text }).items.map((f) => f.id);
const tagNames = (core: Core, id: number) =>
  q.fileDetail(core.db, id)?.tags.map((t) => t.name);

describe("channels that write every workspace's metadata", () => {
  beforeEach(() => setUp(false));
  it("renames a tag for the other workspace too, keyword index included", async () => {
    await invoke("file_add_tag", {
      id: inA,
      workspaceId: ws.activeId,
      name: "beach",
    });
    expect(matches(b, "beach")).toEqual([inB]);

    await invoke("tag_rename", {
      from: { namespace: "", name: "beach" },
      to: "shore",
    });

    expect(tagNames(b, inB)).toEqual(["shore"]);
    expect(matches(b, "shore")).toEqual([inB]);
    expect(matches(b, "beach")).toEqual([]);
  });

  it("deletes a tag from the other workspace too", async () => {
    await invoke("file_add_tag", {
      id: inA,
      workspaceId: ws.activeId,
      name: "beach",
    });
    await invoke("tag_delete", { tags: [{ namespace: "", name: "beach" }] });

    expect(tagNames(b, inB)).toEqual([]);
    expect(matches(b, "beach")).toEqual([]);
  });

  it("clears the other workspace's history and resume points too", async () => {
    q.recordPlay(b.db, inB, "browser", 0);
    q.savePlayPosition(b.db, inB, { position: 300, duration: 600 });
    expect(q.listPlayHistory(b.db, {}).items).toHaveLength(1);
    expect(q.fileDetail(b.db, inB)?.resumePosition).toBe(300);

    await invoke("history_clear");

    expect(q.listPlayHistory(b.db, {}).items).toEqual([]);
    expect(q.fileDetail(b.db, inB)?.resumePosition).toBeNull();
  });
});

describe("the same channels with a workspace still on its own tables", () => {
  beforeEach(() => setUp(true));

  it("reaches it through its own connection", async () => {
    expect(usesOwnMetadata(b.db)).toBe(true);
    await invoke("file_add_tag", {
      id: inA,
      workspaceId: ws.activeId,
      name: "beach",
    });
    tags.addManualTag(b.db, inB, "beach");
    q.recordPlay(b.db, inB, "browser", 0);

    await invoke("tag_rename", {
      from: { namespace: "", name: "beach" },
      to: "shore",
    });
    expect(tagNames(a, inA)).toEqual(["shore"]);
    expect(tagNames(b, inB)).toEqual(["shore"]);

    await invoke("history_clear");
    expect(q.listPlayHistory(b.db, {}).items).toEqual([]);
  });
});
