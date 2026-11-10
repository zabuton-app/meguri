import { describe, expect, it } from "vitest";
import { diffPaths } from "../pathDiff";

describe("diffPaths", () => {
  it("marks the folders after the shared prefix as different", () => {
    expect(
      diffPaths(["Videos/2025/kyoto/a.mp4", "Videos/2025/inbox/a.mp4"]),
    ).toEqual([
      [
        { text: "Videos/2025/", kind: "same" },
        { text: "kyoto/", kind: "diff" },
        { text: "a.mp4", kind: "name" },
      ],
      [
        { text: "Videos/2025/", kind: "same" },
        { text: "inbox/", kind: "diff" },
        { text: "a.mp4", kind: "name" },
      ],
    ]);
  });

  it("highlights only the middle of file names that differ", () => {
    expect(diffPaths(["d/clip.mp4", "d/clip (1).mp4"])).toEqual([
      [
        { text: "d/", kind: "same" },
        { text: "clip.mp4", kind: "name" },
      ],
      [
        { text: "d/", kind: "same" },
        { text: "clip", kind: "name" },
        { text: " (1)", kind: "diff" },
        { text: ".mp4", kind: "name" },
      ],
    ]);
  });

  it("does not let the shared prefix and suffix overlap", () => {
    // "aa" vs "aaa": prefix "aa" leaves no room for a suffix on the shorter one.
    expect(diffPaths(["aa", "aaa"])).toEqual([
      [{ text: "aa", kind: "name" }],
      [
        { text: "aa", kind: "name" },
        { text: "a", kind: "diff" },
      ],
    ]);
  });

  it("handles files at the root and Windows separators", () => {
    expect(diffPaths(["a.mp4", "sub\\a.mp4"])).toEqual([
      [{ text: "a.mp4", kind: "name" }],
      [
        { text: "sub\\", kind: "diff" },
        { text: "a.mp4", kind: "name" },
      ],
    ]);
  });

  it("never splits a surrogate pair", () => {
    const [, b] = diffPaths(["😀a.png", "😁a.png"]);
    expect(b).toEqual([
      { text: "😁", kind: "diff" },
      { text: "a.png", kind: "name" },
    ]);
  });
});
