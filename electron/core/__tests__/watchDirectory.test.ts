// The startup check in watchDirectory: macOS fs.watch can drop changes made
// just after it returns, so the directory is compared once against a snapshot
// from registration. fs.watch is replaced by a watcher that never reports, to
// stand in for those dropped events on any platform.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAN_SYMLINK } from "./symlink.js";

const { watchDirectory } = await import("../watchDirectory.js");

let dir = "";
let listener: ((event: string, filename: string | null) => void) | null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-watch-dir-"));
  listener = null;
  vi.spyOn(fs, "watch").mockImplementation(((
    _dir: string,
    cb: (event: string, filename: string | null) => void,
  ) => {
    listener = cb;
    return Object.assign(new EventEmitter(), { close: () => {} });
  }) as unknown as typeof fs.watch);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const isCss = (name: string | null) => name === null || name.endsWith(".css");
const pastCheck = () => vi.advanceTimersByTime(1000);

describe("watchDirectory startup check", () => {
  it("reports a file added before events start", () => {
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    pastCheck();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports a save to an existing file before events start", () => {
    const file = path.join(dir, "a.css");
    fs.writeFileSync(file, "a{}");
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    fs.writeFileSync(file, "ab{}");
    pastCheck();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports a file removed before events start", () => {
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    fs.rmSync(path.join(dir, "a.css"));
    pastCheck();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays quiet when nothing it accepts changed", () => {
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    pastCheck();
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it("does not report twice once an event has come through", () => {
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    listener?.("rename", "a.css");
    pastCheck();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not check after it is stopped", () => {
    const onChange = vi.fn();
    const stop = watchDirectory(dir, isCss, onChange);
    stop();
    fs.writeFileSync(path.join(dir, "a.css"), "a{}");
    pastCheck();
    expect(onChange).not.toHaveBeenCalled();
  });

  // The unreadable file is a symlink loop, so this needs the privilege.
  it.skipIf(!CAN_SYMLINK)(
    "still sees other files when one cannot be read",
    () => {
      fs.symlinkSync("loop.css", path.join(dir, "loop.css"));
      const onChange = vi.fn();
      const stop = watchDirectory(dir, isCss, onChange);
      fs.writeFileSync(path.join(dir, "a.css"), "a{}");
      pastCheck();
      expect(onChange).toHaveBeenCalledTimes(1);
      stop();
    },
  );
});
