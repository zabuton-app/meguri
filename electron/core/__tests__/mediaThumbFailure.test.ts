// generateThumb when FFmpeg fails part-way or exits without a frame: the
// thumbnail already on disk must survive, and no temporary file is left (#679).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

/** What the stubbed FFmpeg does with its output file (its last argument). */
const behavior = vi.hoisted(() => ({
  run: (_output: string, done: Callback) => done(null, "", ""),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (_file: string, args: string[], _opts: unknown, cb: Callback) =>
    behavior.run(args[args.length - 1], cb),
}));
vi.mock("../logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn() },
}));

import { generateThumb } from "../media.js";

const OLD = Buffer.from("previous thumbnail");
let dir: string;
let dest: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-thumb-fail-"));
  dest = path.join(dir, "thumb.webp");
  fs.writeFileSync(dest, OLD);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateThumb (automatic video frame)", () => {
  it("reports an empty output and keeps the previous thumbnail", async () => {
    behavior.run = (output, done) => {
      fs.writeFileSync(output, "");
      done(null, "", "");
    };
    await expect(generateThumb("/media/a.mp4", "video", dest)).resolves.toBe(
      false,
    );
    expect(fs.readFileSync(dest)).toEqual(OLD);
    expect(fs.readdirSync(dir)).toEqual(["thumb.webp"]);
  });

  it("keeps the previous thumbnail when FFmpeg dies part-way", async () => {
    behavior.run = (output, done) => {
      fs.writeFileSync(output, "trunc");
      done(Object.assign(new Error("killed"), { stderr: "" }), "", "");
    };
    await expect(generateThumb("/media/a.mp4", "video", dest)).resolves.toBe(
      false,
    );
    expect(fs.readFileSync(dest)).toEqual(OLD);
    expect(fs.readdirSync(dir)).toEqual(["thumb.webp"]);
  });

  it("replaces the thumbnail once a frame is written", async () => {
    behavior.run = (output, done) => {
      fs.writeFileSync(output, "new frame");
      done(null, "", "");
    };
    await expect(generateThumb("/media/a.mp4", "video", dest)).resolves.toBe(
      true,
    );
    expect(fs.readFileSync(dest, "utf8")).toBe("new frame");
    expect(fs.readdirSync(dir)).toEqual(["thumb.webp"]);
  });
});
