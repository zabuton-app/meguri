import { describe, expect, it } from "vitest";
import { fileNameOf } from "../relPath";

describe("fileNameOf", () => {
  it("extracts the file name from a POSIX relative path", () => {
    expect(fileNameOf("sub/dir/video.mp4")).toBe("video.mp4");
  });

  it("extracts the file name from a Windows relative path", () => {
    expect(fileNameOf("sub\\dir\\video.mp4")).toBe("video.mp4");
  });

  it("returns the path as-is when it has no separator", () => {
    expect(fileNameOf("video.mp4")).toBe("video.mp4");
  });
});
