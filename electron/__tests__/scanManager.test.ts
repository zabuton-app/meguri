import { defaultAutoTagConfig } from "../../shared/autoTag.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runScan = vi.hoisted(() => vi.fn());
vi.mock("../core/jobs.js", () => ({ runScan }));
vi.mock("../core/queries.js", () => ({ clearExcludedFiles: vi.fn() }));
vi.mock("../core/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ScanManager } from "../scanManager.js";
import { ScanRootUnreadableError } from "../core/scan.js";

type Deps = ConstructorParameters<typeof ScanManager>[0];

function fakeCore(id: string) {
  return { id, core: { db: {}, rootId: 1, root: `/${id}` } };
}

/**
 * A runScan that stays pending until aborted, or until the returned `finish`
 * completes every scan started so far. Each call gets its own settle, so
 * several concurrent scans (the All view) resolve independently.
 */
function pendingScan() {
  const finishers: (() => void)[] = [];
  runScan.mockImplementation(
    (
      _core: unknown,
      jobId: string,
      report: (e: unknown) => void,
      opts: { signal: AbortSignal },
    ) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = (aborted: boolean) => {
          if (settled) return;
          settled = true;
          report({ type: "done", jobId, stats: {}, aborted });
          resolve();
        };
        finishers.push(() => settle(false));
        opts.signal.addEventListener("abort", () => settle(true));
      }),
  );
  return () => finishers.forEach((f) => f());
}

function makeDeps(
  overrides: Partial<Deps> = {},
): Deps & { invalidateCaches: ReturnType<typeof vi.fn> } {
  const a = fakeCore("a");
  const invalidateCaches = vi.fn().mockResolvedValue(undefined);
  return {
    invalidateCaches,
    ws: {
      isAll: () => false,
      allCores: () => [a],
      active: () => a.core,
      activeId: "a",
      syncTagIndexes: vi.fn(),
    } as unknown as Deps["ws"],
    queryClient: { invalidateCaches } as unknown as Deps["queryClient"],
    emit: vi.fn(),
    isQuitting: () => false,
    autoTag: () => ({ config: defaultAutoTagConfig(), version: 0 }),
    deriveAutoTags: () => Promise.resolve([]),
    ...overrides,
  };
}

describe("ScanManager", () => {
  beforeEach(() => {
    runScan.mockReset();
  });

  it("does not start a second scan of a workspace already being scanned", async () => {
    const finish = pendingScan();
    const scans = new ScanManager(makeDeps());
    expect(scans.start()).toMatch(/^job-/);
    expect(scans.start()).toBe("");
    expect(runScan).toHaveBeenCalledTimes(1);
    finish();
    await scans.abort("a");
    // Settled: the same workspace can be scanned again.
    pendingScan();
    expect(scans.start()).not.toBe("");
  });

  it("leaves the auto-tagging settings to be read when the tagging starts", async () => {
    // A save while the files are walked and hashed is no reason to skip
    // tagging them: the scan reads the settings only once it tags.
    const finish = pendingScan();
    const autoTag = vi.fn(() => ({
      config: defaultAutoTagConfig(),
      version: 0,
    }));
    const scans = new ScanManager(makeDeps({ autoTag }));
    scans.start();
    const [, , , opts] = runScan.mock.calls[0] as [
      unknown,
      string,
      unknown,
      { autoTag: unknown },
    ];
    expect(opts.autoTag).toBe(autoTag);
    expect(autoTag).not.toHaveBeenCalled();
    finish();
    await scans.abort("a");
  });

  it("starts nothing once the app is quitting", () => {
    const scans = new ScanManager(makeDeps({ isQuitting: () => true }));
    expect(scans.start()).toBe("");
    expect(runScan).not.toHaveBeenCalled();
  });

  it("abort() resolves once the aborted scan has settled and caches are cleared", async () => {
    pendingScan();
    const deps = makeDeps();
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({ aborted: true }),
    );
    expect(deps.invalidateCaches).toHaveBeenCalledTimes(1);
  });

  it("in the All view scans every workspace and returns the first job id", async () => {
    pendingScan();
    const deps = makeDeps({
      ws: {
        isAll: () => true,
        allCores: () => [fakeCore("a"), fakeCore("b")],
        active: () => null,
        activeId: "all",
        syncTagIndexes: vi.fn(),
      } as unknown as Deps["ws"],
    });
    const scans = new ScanManager(deps);
    expect(scans.start()).toBe("job-1");
    expect(runScan).toHaveBeenCalledTimes(2);
    await scans.abortAll();
  });

  it("says why a scan failed when the workspace's folder could not be read", async () => {
    runScan.mockRejectedValue(
      new ScanRootUnreadableError("the scan root cannot be read (ENOENT)"),
    );
    const deps = makeDeps();
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({
        error: true,
        errorReason: "root-unreadable",
        workspaceId: "a",
      }),
    );
  });

  it("remembers a workspace whose folder could not be read until a scan reaches it", async () => {
    runScan.mockRejectedValueOnce(
      new ScanRootUnreadableError("the scan root cannot be read (ENOENT)"),
    );
    const scans = new ScanManager(makeDeps());
    scans.start();
    await scans.abort("a");
    expect(scans.unreadableWorkspaces()).toEqual(["a"]);

    runScan.mockImplementationOnce(
      (_core: unknown, jobId: string, report: (e: unknown) => void) => {
        report({ type: "done", jobId, stats: {} });
        return Promise.resolve();
      },
    );
    scans.start();
    await scans.abort("a");
    expect(scans.unreadableWorkspaces()).toEqual([]);
  });

  it("reports a failed scan as scan:done with an error flag and frees the workspace", async () => {
    runScan.mockRejectedValue(new Error("boom"));
    const deps = makeDeps();
    const syncTagIndexes = vi.fn();
    Object.assign(deps.ws, { syncTagIndexes });
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({ error: true }),
    );
    // Even a failed scan may have tagged some files before it stopped.
    expect(syncTagIndexes).toHaveBeenCalledTimes(1);
    pendingScan();
    expect(scans.start()).not.toBe("");
  });
});
