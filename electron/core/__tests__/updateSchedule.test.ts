// Background update checks (#284): after launch, then on a timer, and each
// release announced once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateInfo } from "../../../shared/ipc/schema.js";
import {
  CHECK_TICK_MS,
  FIRST_CHECK_DELAY_MS,
  scheduleUpdateChecks,
} from "../updateSchedule.js";

const info = (latest: string, available = true): UpdateInfo => ({
  current: "0.11.0",
  latest,
  available,
  url: "https://example.invalid/release",
  name: null,
  publishedAt: null,
});

describe("scheduleUpdateChecks", () => {
  let enabled: boolean;
  let result: UpdateInfo | null;
  const check = vi.fn(() => Promise.resolve(result));
  const announce = vi.fn();
  const onError = vi.fn();
  let checks: ReturnType<typeof scheduleUpdateChecks>;

  beforeEach(() => {
    vi.useFakeTimers();
    enabled = true;
    result = null;
    check.mockClear();
    announce.mockClear();
    onError.mockClear();
    checks = scheduleUpdateChecks({
      check,
      isEnabled: () => enabled,
      announce,
      onError,
    });
  });
  afterEach(() => {
    checks.stop();
    vi.useRealTimers();
  });

  it("checks after launch, then on every tick", async () => {
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS * 3);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("announces a release once, and the next one again", async () => {
    result = info("0.12.0");
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS * 2);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(info("0.12.0"));

    result = info("0.12.1");
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(info("0.12.1"));
  });

  it("does not announce when nothing newer is out, or the check did not run", async () => {
    result = info("0.11.0", false);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    result = null;
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(announce).not.toHaveBeenCalled();
  });

  it("skips ticks while automatic checks are off, and resumes when on", async () => {
    enabled = false;
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_TICK_MS);
    expect(check).not.toHaveBeenCalled();
    enabled = true;
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reports a failed check and keeps going", async () => {
    check.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("announces the release again once the renderer that showed it is gone", async () => {
    result = info("0.12.0");
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    checks.forget();
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("stops on request", async () => {
    checks.stop();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_TICK_MS);
    expect(check).not.toHaveBeenCalled();
  });
});
