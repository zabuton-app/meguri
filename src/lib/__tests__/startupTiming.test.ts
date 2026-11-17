// The renderer's startup line (#558): written once, when the first list
// settles, for the first page of the first window only, counted from main's
// start, and saying how startup ended.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "@shared/ipc/schema";
import {
  logStartupTimings,
  markStartup,
  startupOutcome,
} from "@/lib/startupTiming";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: { info } }));

function status(patch: Partial<AppStatus>): AppStatus {
  return {
    root: null,
    ready: true,
    initError: null,
    initErrorKind: null,
    mediaBase: null,
    workspaceId: "ws",
    devMode: false,
    ...patch,
  };
}

const settled = { shown: false, failed: false };

describe("startupOutcome", () => {
  it("waits for the status and for the list", () => {
    expect(startupOutcome(undefined, settled)).toBeNull();
    expect(startupOutcome(status({}), settled)).toBeNull();
  });

  it("ends with the list, shown or failed", () => {
    expect(startupOutcome(status({}), { ...settled, shown: true })).toBe(
      "list shown",
    );
    expect(startupOutcome(status({}), { ...settled, failed: true })).toBe(
      "list failed",
    );
  });

  it("ends with no list when no workspace is open, or it failed", () => {
    expect(startupOutcome(status({ ready: false }), settled)).toBe(
      "no workspace",
    );
    expect(
      startupOutcome(status({ ready: false, initError: "bad" }), settled),
    ).toBe("workspace error");
  });

  it("waits through a library merge: the list follows it", () => {
    expect(
      startupOutcome(
        status({ ready: false, libraryMerge: { done: 0, total: 2 } }),
        settled,
      ),
    ).toBeNull();
  });
});

describe("logStartupTimings", () => {
  beforeEach(() => {
    info.mockClear();
    performance.clearMarks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOrigin(startupOrigin: number) {
    vi.stubGlobal("api", { ...window.api, startupOrigin });
  }

  it("writes the line once, counted from main's start, with the first list", () => {
    stubOrigin(performance.timeOrigin - 1000);
    markStartup("script");
    logStartupTimings("list shown");
    logStartupTimings("list shown");
    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0][0] as string;
    expect(line).toMatch(
      /^\[startup\] renderer \(list shown, since process start\): script \d+ms, first list \d+ms$/,
    );
    expect(Number(/script (\d+)ms/.exec(line)![1])).toBeGreaterThanOrEqual(
      1000,
    );
  });

  it("marks no first list when startup ended without one", () => {
    stubOrigin(performance.timeOrigin);
    markStartup("script");
    logStartupTimings("no workspace");
    expect(info.mock.calls[0][0]).toMatch(
      /\(no workspace, since process start\): script \d+ms$/,
    );
  });

  it("writes nothing for a page loaded again in the same window", () => {
    stubOrigin(performance.timeOrigin);
    sessionStorage.setItem("meguri:startup-logged", "1");
    logStartupTimings("list shown");
    expect(info).not.toHaveBeenCalled();
  });

  it("writes nothing without main's start time (a window made later)", () => {
    stubOrigin(0);
    logStartupTimings("list shown");
    expect(info).not.toHaveBeenCalled();
  });

  it("counts a step marked twice (StrictMode) at its first time", () => {
    markStartup("first render");
    markStartup("first render");
    expect(performance.getEntriesByName("startup:first render")).toHaveLength(
      1,
    );
  });
});
