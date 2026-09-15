import { describe, expect, it } from "vitest";
import { fileNameOf, folderOf } from "@/lib/relPath";

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

describe("folderOf", () => {
  it("keeps the folder part of a POSIX relative path", () => {
    expect(folderOf("trips/okinawa/day2.mp4")).toBe("trips/okinawa");
  });

  it("keeps the folder part of a Windows relative path", () => {
    expect(folderOf("trips\\okinawa\\day2.mp4")).toBe("trips\\okinawa");
  });

  it("is empty for a file at the root", () => {
    expect(folderOf("day2.mp4")).toBe("");
  });
});
