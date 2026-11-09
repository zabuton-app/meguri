import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { EventEmitter } from "node:events";
import { FolderWatcher } from "../../folderWatcher.js";

describe("native folder watcher scheduling", () => {
  let listener: (event: string, file: string | null) => void;
  let native: EventEmitter & { close: ReturnType<typeof vi.fn> };
  let watcher: FolderWatcher;
  const changed = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    changed.mockReset();
    vi.spyOn(fs, "watch").mockImplementation((...args: unknown[]) => {
      listener = args.at(-1) as typeof listener;
      native = Object.assign(new EventEmitter(), { close: vi.fn() });
      return native as unknown as fs.FSWatcher;
    });
    vi.spyOn(fsp, "stat").mockResolvedValue({
      isDirectory: () => true,
    } as fs.Stats);
    vi.spyOn(fsp, "lstat").mockResolvedValue({
      size: 100,
      mtimeMs: 1234,
    } as fs.Stats);
    watcher = new FolderWatcher(changed);
    watcher.sync([{ id: "root", path: "/media" }], true);
  });
  afterEach(() => {
    watcher.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does no filesystem polling and starts no scans while idle", async () => {
    await vi.advanceTimersByTimeAsync(3600000);
    expect(fsp.stat).not.toHaveBeenCalled();
    expect(fsp.lstat).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces notifications and checks stability before dispatching one batch", async () => {
    for (let i = 0; i < 20; i++) listener("change", "new.mp4");
    await vi.advanceTimersByTimeAsync(2000);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(changed).toHaveBeenCalledExactlyOnceWith("root", ["new.mp4"]);
    expect(fsp.lstat).toHaveBeenCalledTimes(2);
  });
  it("does not let one continuing download hold back a settled file", async () => {
    listener("change", "done.mp4");
    listener("change", "busy.mp4");
    await vi.advanceTimersByTimeAsync(1000);
    listener("change", "busy.mp4");
    await vi.advanceTimersByTimeAsync(1750);
    expect(changed).toHaveBeenCalledExactlyOnceWith("root", ["done.mp4"]);
  });
  it("ignores unrelated writes and path escapes, and cancels pending work on close", async () => {
    listener("change", "notes.txt");
    listener("rename", "../outside.mp4");
    listener("rename", ".hidden.mp4");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fsp.stat).not.toHaveBeenCalled();
    listener("rename", "new.png");
    watcher.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(changed).not.toHaveBeenCalled();
  });
  it("ignores the application's own catalogue storage inside a broadly scanned folder", async () => {
    watcher.close();
    watcher = new FolderWatcher(changed, undefined, ["/media/cache"]);
    watcher.sync([{ id: "root", path: "/media" }], true);
    listener("rename", "cache/thumb.webp");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fsp.stat).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
  it("reports unavailable folders and retries only when explicitly synchronized", () => {
    native.emit("error", new Error("drive disconnected"));
    expect(watcher.status()).toEqual({
      enabled: true,
      watched: 0,
      unavailable: ["root"],
    });
    watcher.sync([{ id: "root", path: "/media" }], true);
    expect(fs.watch).toHaveBeenCalledTimes(2);
    expect(watcher.status().watched).toBe(1);
  });
});
