import os from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock("electron-log/main", () => ({ default: { hooks: [] } }));

// A fixed home directory, so the tests do not depend on where they run (a
// HOME of "/" would redact every path).
const HOME = "/home/tester";
vi.spyOn(os, "homedir").mockReturnValue(HOME);

const { redactForLog, redactRoots, redactString } =
  await import("../logger.js");

redactRoots(["/mnt/media", "D:\\Videos"]);

describe("redactString", () => {
  it("redacts a path under a workspace root outside the home directory", () => {
    expect(redactString("produced no output for /mnt/media/clip.mp4")).toBe(
      "produced no output for <media-path>",
    );
    expect(redactString("scan root D:\\Videos")).toBe("scan root <media-path>");
  });

  it("redacts a whole path with spaces on both separators", () => {
    expect(redactString("file: /mnt/media/My Clips/a b.mp4")).toBe(
      "file: <media-path>",
    );
    expect(redactString("file: D:\\Videos\\My Clips\\a b.mp4")).toBe(
      "file: <media-path>",
    );
    expect(redactString(`file: ${HOME}/My Videos/a b.mp4`)).toBe(
      "file: <user-path>",
    );
  });

  it("runs to the end of the line, past quotes in a file name", () => {
    expect(
      redactString("ENOENT: open '/mnt/media/Bob's a b.mp4' (retrying)\nnext"),
    ).toBe("ENOENT: open '<media-path>\nnext");
  });

  it("redacts the input file named in ffmpeg stderr", () => {
    const stderr = [
      "ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers",
      "[in#0 @ 0x55d0] Error opening input: Invalid data found when processing input",
      "Error opening input file /mnt/media/Holiday 2024/beach day.mkv.",
      "Error opening input files: Invalid data found when processing input",
    ].join("\n");
    const out = redactString(stderr);
    expect(out).not.toContain("Holiday");
    expect(out).not.toContain("beach");
    expect(out).toContain("Error opening input file <media-path>\n");
    expect(out).toContain("Error opening input files: Invalid data");
  });

  it("leaves a message without a known path alone", () => {
    expect(redactString("/tmp/x is not a root")).toBe("/tmp/x is not a root");
  });

  it("covers a root added later", () => {
    expect(redactString("/srv/new/a.mp4")).toBe("/srv/new/a.mp4");
    redactRoots(["/srv/new"]);
    expect(redactString("/srv/new/a.mp4")).toBe("<media-path>");
  });
});

describe("redactForLog", () => {
  it("replaces the path of a Node error by name, keeping its code", () => {
    const e = Object.assign(
      new Error(
        "ENOENT: no such file or directory, open '/data/My Clips/a b.mp4'",
      ),
      {
        errno: -2,
        code: "ENOENT",
        syscall: "open",
        path: "/data/My Clips/a b.mp4",
      },
    );
    const out = redactForLog(e);
    expect(out).not.toContain("a b.mp4");
    expect(out).toContain("open '<path>'");
    expect(out).toContain("{ code: 'ENOENT', errno: -2, syscall: 'open' }");
  });

  it("replaces a failed command line and leaves out its output", () => {
    const cmd = "ffmpeg -i /data/clip.mp4 /data/out.png";
    const e = Object.assign(new Error(`Command failed: ${cmd}\nboom`), {
      code: 1,
      cmd,
      spawnargs: ["-i", "/data/clip.mp4"],
      stderr: "/data/clip.mp4: Invalid data",
    });
    const out = redactForLog(e);
    expect(out).not.toContain("clip.mp4");
    expect(out).toContain("Command failed: <cmd>");
    expect(out).toContain("{ code: 1 }");
  });

  it("still redacts a known root in an error's message", () => {
    const out = redactForLog(new Error("cannot read /mnt/media/a b.mp4"));
    expect(out).toContain("cannot read <media-path>");
    expect(out).not.toContain("a b.mp4");
  });

  it("redacts a Windows path whose backslashes inspect doubled", () => {
    const out = redactForLog({ path: "D:\\Videos\\Private\\clip.mp4" });
    expect(out).toBe("{ path: '<media-path>");
  });
});
