// Where ffmpeg / ffprobe are run from: the bundled executables, or the system
// ones a package names with MEGURI_FFMPEG_DIR.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toolPath } from "../ffmpeg-paths.js";

const BUNDLED =
  "/opt/meguri/resources/app.asar/node_modules/@zabuton-app/ffmpeg-binaries/bin/ffmpeg";
const UNPACKED =
  "/opt/meguri/resources/app.asar.unpacked/node_modules/@zabuton-app/ffmpeg-binaries/bin/ffmpeg";

describe("toolPath", () => {
  // "" stands for an unset MEGURI_FFMPEG_DIR: undefined would take the
  // default, the variable of the shell running the tests.
  it("runs the bundled executable from app.asar.unpacked", () => {
    // Even when the file is missing: nothing checks the disk, so a build that
    // lost it fails visibly instead of switching to the system FFmpeg.
    expect(toolPath(BUNDLED, "ffmpeg", "")).toBe(UNPACKED);
  });

  it("runs the system executable from MEGURI_FFMPEG_DIR", () => {
    expect(toolPath(BUNDLED, "ffmpeg", "/usr/bin")).toBe(
      path.join("/usr/bin", "ffmpeg"),
    );
    expect(toolPath(null, "ffprobe", "/usr/bin")).toBe(
      path.join("/usr/bin", "ffprobe"),
    );
  });

  it("uses PATH on a platform the package has no build for", () => {
    expect(toolPath(null, "ffprobe", "")).toBe("ffprobe");
  });
});
