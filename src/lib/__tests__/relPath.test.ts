import { describe, expect, it } from "vitest";
import { dirOf, fileNameOf, fileNameParts, folderPathOf } from "@/lib/relPath";

describe("fileNameParts", () => {
  it.each(["folder/Interview.final.v2.MOV", "folder\\Interview.final.v2.MOV"])(
    "separates only the final extension of %s",
    (path) => {
      expect(fileNameParts(path)).toEqual({
        name: "Interview.final.v2",
        extension: ".MOV",
      });
    },
  );
  it.each(["README", ".hidden", "trailing."])(
    "preserves %s without an extension",
    (name) => {
      expect(fileNameParts(name)).toEqual({ name, extension: "" });
    },
  );
});

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

describe("dirOf", () => {
  it("returns the folder of a POSIX relative path", () => {
    expect(dirOf("sub/dir/video.mp4")).toBe("sub/dir");
  });

  it("returns the folder of a Windows relative path", () => {
    expect(dirOf("sub\\dir\\video.mp4")).toBe("sub\\dir");
  });

  it("returns an empty string for a file at the root", () => {
    expect(dirOf("video.mp4")).toBe("");
  });
});

describe("folderPathOf", () => {
  it('names the folder in the "/"-separated form', () => {
    expect(folderPathOf("sub/dir/video.mp4")).toBe("sub/dir");
    expect(folderPathOf("sub\\dir\\video.mp4")).toBe("sub/dir");
  });

  it("is the root for a file at the root", () => {
    expect(folderPathOf("video.mp4")).toBe("");
  });
});
