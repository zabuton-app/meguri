import { beforeEach, describe, expect, it, vi } from "vitest";

const runScan = vi.hoisted(() => vi.fn());
vi.mock("../core/jobs.js", () => ({ runScan }));
vi.mock("../core/queries.js", () => ({ clearExcludedFiles: vi.fn() }));
vi.mock("../core/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ScanManager } from "../scanManager.js";

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
      isCrossWorkspace: () => false,
      allCores: () => [a],
      active: () => a.core,
      activeId: "a",
    } as unknown as Deps["ws"],
    queryClient: { invalidateCaches } as unknown as Deps["queryClient"],
    emit: vi.fn(),
    isQuitting: () => false,
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
        isCrossWorkspace: () => true,
        allCores: () => [fakeCore("a"), fakeCore("b")],
        active: () => null,
        activeId: "all",
      } as unknown as Deps["ws"],
    });
    const scans = new ScanManager(deps);
    expect(scans.start()).toBe("job-1");
    expect(runScan).toHaveBeenCalledTimes(2);
    await scans.abortAll();
  });

  it("reports a failed scan as scan:done with an error flag and frees the workspace", async () => {
    runScan.mockRejectedValue(new Error("boom"));
    const deps = makeDeps();
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({ error: true }),
    );
    pendingScan();
    expect(scans.start()).not.toBe("");
  });
});
