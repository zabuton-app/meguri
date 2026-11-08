import { beforeEach, expect, it, vi } from "vitest";
import { ScanManager, type ScanManagerDeps } from "../../scanManager.js";
import { emptyScanStats, type ScanStats } from "../scan.js";
import type { Core } from "../index.js";
import type { DeriveAutoTags } from "../autoTagDeriver.js";
import { defaultAutoTagConfig } from "../../../shared/autoTag.js";

const state = vi.hoisted(() => ({
  changed: undefined as
    ((id: string, paths: string[] | undefined) => void) | undefined,
  run: vi.fn(),
  unavailable: [] as string[],
  reconnect: false,
}));
vi.mock("../jobs.js", () => ({ runScan: state.run }));
vi.mock("../../folderWatcher.js", () => ({
  MAX_PENDING_PATHS: 1000,
  FolderWatcher: class {
    constructor(callback: typeof state.changed) {
      state.changed = callback;
    }
    sync() {
      if (state.reconnect) state.unavailable = [];
    }
    remove() {}
    close() {}
    status() {
      return { enabled: true, watched: 1, unavailable: state.unavailable };
    }
  },
}));

let resolves: ((stats: ScanStats) => void)[];
let manager: ScanManager;
let deps: ScanManagerDeps;
beforeEach(() => {
  state.unavailable = [];
  state.reconnect = false;
  resolves = [];
  state.run
    .mockReset()
    .mockImplementation(
      () => new Promise<ScanStats>((resolve) => resolves.push(resolve)),
    );
  const core = {} as Core;
  deps = {
    ws: {
      list: () => [{ id: "root", path: "/media", active: true }],
      pathOf: () => "/media",
      byId: () => core,
      isAll: () => false,
      active: () => core,
      activeId: "root",
    } as unknown as ScanManagerDeps["ws"],
    queryClient: {
      invalidateCaches: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScanManagerDeps["queryClient"],
    emit: vi.fn(),
    isQuitting: () => false,
    autoTag: () => ({ config: defaultAutoTagConfig(), version: 0 }),
    deriveAutoTags: vi.fn<DeriveAutoTags>(),
  };
  manager = new ScanManager(deps);
  manager.setWatching(true);
});

it("coalesces changes arriving during a scan into one follow-up", async () => {
  manager.start();
  state.changed!("root", ["one.png"]);
  state.changed!("root", ["two.png", "one.png"]);
  expect(state.run).toHaveBeenCalledTimes(1);
  resolves[0](emptyScanStats());
  await vi.waitFor(() => expect(state.run).toHaveBeenCalledTimes(2));
  expect(
    (state.run.mock.calls[1][3] as { paths: string[] }).paths.sort(),
  ).toEqual(["one.png", "two.png"]);
  resolves[1](emptyScanStats());
  await manager.abortAll();
  manager.stopWatching();
});

it("reconciles a previously unavailable drive once when its watch reconnects", async () => {
  state.unavailable = ["root"];
  state.reconnect = true;
  manager.syncWatchers();
  expect(state.run).toHaveBeenCalledTimes(1);
  expect(
    (state.run.mock.calls[0][3] as { paths?: string[] }).paths,
  ).toBeUndefined();
  resolves[0](emptyScanStats());
  await manager.abortAll();
  manager.stopWatching();
});

it("does not lose a queued batch when an older scan finishes invalidating caches", async () => {
  let invalidate: (() => void) | undefined;
  vi.spyOn(deps.queryClient, "invalidateCaches").mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        invalidate = resolve;
      }),
  );
  manager.start();
  resolves[0](emptyScanStats());
  await vi.waitFor(() => expect(invalidate).toBeTypeOf("function"));
  state.changed!("root", ["a.png"]);
  state.changed!("root", ["b.png"]);
  expect(state.run).toHaveBeenCalledTimes(2);
  invalidate!();
  await Promise.resolve();
  resolves[1](emptyScanStats());
  await vi.waitFor(() => expect(state.run).toHaveBeenCalledTimes(3));
  expect((state.run.mock.calls[2][3] as { paths: string[] }).paths).toEqual([
    "b.png",
  ]);
  resolves[2](emptyScanStats());
  await manager.abortAll();
  manager.stopWatching();
});

it("drops pending batches when canceled, while allowing later filesystem changes", async () => {
  manager.start();
  state.changed!("root", ["pending.png"]);
  const stopped = manager.abort("root");
  resolves[0](emptyScanStats());
  await stopped;
  expect(state.run).toHaveBeenCalledTimes(1);
  state.changed!("root", ["later.png"]);
  expect(state.run).toHaveBeenCalledTimes(2);
  resolves[1](emptyScanStats());
  await manager.abortAll();
  manager.stopWatching();
});

it("switching watching off aborts automatic work while leaving manual scans alone", async () => {
  state.changed!("root", ["auto.png"]);
  const automatic = state.run.mock.calls[0][3] as { signal: AbortSignal };
  manager.setWatching(false);
  expect(automatic.signal.aborted).toBe(true);
  resolves[0](emptyScanStats());
  await manager.abortAll();
  manager.setWatching(true);
  manager.start();
  const manual = state.run.mock.calls[1][3] as { signal: AbortSignal };
  manager.setWatching(false);
  expect(manual.signal.aborted).toBe(false);
  resolves[1](emptyScanStats());
  await manager.abortAll();
  manager.stopWatching();
});
