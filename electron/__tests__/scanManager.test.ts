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
      isAll: () => false,
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
        isAll: () => true,
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

  it("tells the post-scan hook which workspace settled, and whether it was aborted", async () => {
    const onScanFinished = vi.fn();
    const finish = pendingScan();
    const deps = makeDeps({ onScanFinished });
    const scans = new ScanManager(deps);

    scans.start();
    finish();
    await vi.waitFor(() => expect(onScanFinished).toHaveBeenCalledTimes(1));
    expect(onScanFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ wsId: "a", aborted: false, failed: false }),
    );
    // After the caches: whatever the hook reads must already see the new files.
    expect(deps.invalidateCaches).toHaveBeenCalledTimes(1);

    pendingScan();
    scans.start();
    await scans.abort("a");
    expect(onScanFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ wsId: "a", aborted: true }),
    );
  });

  it("tells the hook a scan failed, rather than calling it a success", async () => {
    runScan.mockRejectedValue(new Error("boom"));
    const onScanFinished = vi.fn();
    const scans = new ScanManager(makeDeps({ onScanFinished }));
    scans.start();
    // Not abort(): that would mark the scan aborted before it settles.
    await vi.waitFor(() =>
      expect(onScanFinished).toHaveBeenCalledWith(
        expect.objectContaining({ failed: true, aborted: false }),
      ),
    );
  });

  it("abort() waits through the post-scan hook, not just the scan", async () => {
    // The hook runs after an await on the query worker. A workspace removed in
    // that gap must not have abort() return before the hook has had its turn.
    let releaseCaches!: () => void;
    const onScanFinished = vi.fn();
    const deps = makeDeps({ onScanFinished });
    deps.invalidateCaches.mockReturnValueOnce(
      new Promise<void>((r) => {
        releaseCaches = r;
      }),
    );
    const finish = pendingScan();
    const scans = new ScanManager(deps);
    scans.start();
    finish();
    await vi.waitFor(() => expect(deps.invalidateCaches).toHaveBeenCalled());

    let aborted = false;
    const abort = scans.abort("a").then(() => (aborted = true));
    await Promise.resolve();
    expect(aborted).toBe(false);
    releaseCaches();
    await abort;
    expect(onScanFinished).toHaveBeenCalledTimes(1);
  });

  it("frees the workspace even when the post-scan hook throws", async () => {
    pendingScan();
    const scans = new ScanManager(
      makeDeps({
        onScanFinished: () => {
          throw new Error("hook");
        },
      }),
    );
    scans.start();
    await scans.abort("a");
    pendingScan();
    expect(scans.start()).not.toBe("");
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
