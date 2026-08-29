import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const VOLUME_KEY = "meguri.player.volume";
const MUTED_KEY = "meguri.player.muted";

/**
 * The store reads storage once at import time, so every test gets a fresh
 * module with whatever localStorage was seeded beforehand.
 */
async function loadStore() {
  vi.resetModules();
  return await import("@/hooks/useVolume");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useVolume store", () => {
  it("starts at full volume, unmuted, with nothing stored", async () => {
    const { useVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    expect(result.current).toEqual({ volume: 1, muted: false });
  });

  it("restores the persisted volume and mute on load", async () => {
    localStorage.setItem(VOLUME_KEY, "0.3");
    localStorage.setItem(MUTED_KEY, "1");
    const { useVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    expect(result.current).toEqual({ volume: 0.3, muted: true });
  });

  it("falls back to full volume when the stored value is not a number", async () => {
    localStorage.setItem(VOLUME_KEY, "loud");
    const { useVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    expect(result.current.volume).toBe(1);
  });

  it("clamps a stored value from outside the range", async () => {
    localStorage.setItem(VOLUME_KEY, "7");
    const { useVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    expect(result.current.volume).toBe(1);
  });

  it("clamps what callers set and persists it", async () => {
    const { useVolume, setVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => setVolume(-2));
    expect(result.current.volume).toBe(0);
    act(() => setVolume(4));
    expect(result.current.volume).toBe(1);
    act(() => setVolume(0.4));
    expect(result.current.volume).toBeCloseTo(0.4);
    expect(localStorage.getItem(VOLUME_KEY)).toBe("0.4");
  });

  it("keeps the volume across a mute round trip", async () => {
    const { useVolume, setVolume, toggleMuted } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => setVolume(0.5));
    act(() => toggleMuted());
    expect(result.current).toEqual({ volume: 0.5, muted: true });
    expect(localStorage.getItem(MUTED_KEY)).toBe("1");
    act(() => toggleMuted());
    expect(result.current).toEqual({ volume: 0.5, muted: false });
  });

  it("leaves mute behind when the volume is set outright", async () => {
    const { useVolume, setVolume, toggleMuted } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => setVolume(0.5));
    act(() => toggleMuted());
    act(() => setVolume(0.8));
    expect(result.current).toEqual({ volume: 0.8, muted: false });
  });

  it("keeps mute while the level is nudged", async () => {
    // Turning it down while muted means "lower it for when the sound comes
    // back", not "start playing it out loud now".
    const { useVolume, setVolume, toggleMuted, bumpVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => setVolume(0.5));
    act(() => toggleMuted());
    act(() => bumpVolume(0.05));
    expect(result.current.muted).toBe(true);
    expect(result.current.volume).toBeCloseTo(0.55);
  });

  it("stops bumping at the ends of the range", async () => {
    const { useVolume, setVolume, bumpVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => setVolume(0.98));
    act(() => bumpVolume(0.05));
    expect(result.current.volume).toBe(1);
    act(() => setVolume(0.02));
    act(() => bumpVolume(-0.05));
    expect(result.current.volume).toBe(0);
  });

  it("takes the value a media element reports, mute included", async () => {
    const { useVolume, syncFromElement } = await loadStore();
    const { result } = renderHook(() => useVolume());
    act(() => syncFromElement(0.25, true));
    expect(result.current).toEqual({ volume: 0.25, muted: true });
  });

  it("does not notify when the value has not really changed", async () => {
    const { useVolume, setVolume, syncFromElement } = await loadStore();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useVolume();
    });
    act(() => setVolume(0.6));
    const after = renders;
    // The element echoing back the value it was just given must be a no-op,
    // otherwise element -> store -> element loops.
    act(() => syncFromElement(0.6, false));
    act(() => syncFromElement(0.6001, false));
    expect(renders).toBe(after);
    expect(result.current.volume).toBeCloseTo(0.6);
  });

  it("shares one value between separate subscribers", async () => {
    const { useVolume, setVolume } = await loadStore();
    const detail = renderHook(() => useVolume());
    const player = renderHook(() => useVolume());
    act(() => setVolume(0.2));
    expect(detail.result.current.volume).toBeCloseTo(0.2);
    expect(player.result.current.volume).toBeCloseTo(0.2);
    expect(detail.result.current).toBe(player.result.current);
  });

  it("keeps working when storage is unavailable", async () => {
    const { useVolume, setVolume } = await loadStore();
    const { result } = renderHook(() => useVolume());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    act(() => setVolume(0.7));
    expect(result.current.volume).toBeCloseTo(0.7);
  });
});
