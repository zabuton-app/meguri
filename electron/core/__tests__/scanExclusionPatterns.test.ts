// How each kind of scan exclusion pattern becomes the regex a scan runs
// (#529), checked against paths as the scan asks them: relative to the
// workspace root, a folder with a trailing "/".
import { describe, expect, it } from "vitest";
import {
  patternError,
  patternRegex,
  type ExclusionPattern,
} from "../../../shared/scanExclusions.js";

const matches = (p: ExclusionPattern, path: string) =>
  new RegExp(patternRegex(p), "i").test(path);

describe("scan exclusion patterns", () => {
  it("match a name as a whole name, at any depth", () => {
    const p: ExclusionPattern = { kind: "name", value: "private" };
    expect(matches(p, "private/")).toBe(true);
    expect(matches(p, "work/Private/")).toBe(true);
    expect(matches(p, "work/private")).toBe(true);
    expect(matches(p, "work/private-old/")).toBe(false);
    expect(matches(p, "work/myprivate/")).toBe(false);
  });

  it("take * as any text within a name, and nothing else as special", () => {
    const tmp: ExclusionPattern = { kind: "name", value: "*.tmp" };
    expect(matches(tmp, "a/b.tmp")).toBe(true);
    expect(matches(tmp, "a/b.tmp.mp4")).toBe(false);
    expect(matches(tmp, "a/btmp")).toBe(false);
    // Not across folders.
    expect(matches({ kind: "name", value: "a*c" }, "a/c")).toBe(false);
    const dot: ExclusionPattern = { kind: "name", value: ".DS_Store" };
    expect(matches(dot, "x/.DS_Store")).toBe(true);
    expect(matches(dot, "x/aDS_Store")).toBe(false);
    expect(matches({ kind: "name", value: "#recycle" }, "#recycle/")).toBe(
      true,
    );
  });

  it("read a name with a / as a path from the workspace root", () => {
    const p: ExclusionPattern = { kind: "name", value: "/work/private/" };
    expect(matches(p, "work/private/")).toBe(true);
    expect(matches(p, "work/private/a.mp4")).toBe(true);
    expect(matches(p, "old/work/private/")).toBe(false);
  });

  it("read a leading / as the workspace root, even before one name", () => {
    const p: ExclusionPattern = { kind: "name", value: "/private" };
    expect(matches(p, "private/")).toBe(true);
    expect(matches(p, "private/a.mp4")).toBe(true);
    expect(matches(p, "work/private/")).toBe(false);
  });

  it("take a trailing / for folders only", () => {
    const p: ExclusionPattern = { kind: "name", value: "private/" };
    expect(matches(p, "work/private/")).toBe(true);
    expect(matches(p, "work/private")).toBe(false);
  });

  it("match text anywhere for contains, as plain text", () => {
    const p: ExclusionPattern = { kind: "contains", value: "temp" };
    expect(matches(p, "a/attempt.mp4")).toBe(true);
    expect(matches({ kind: "contains", value: "a.b" }, "xaxb")).toBe(false);
  });

  it("run a regex as written", () => {
    const p: ExclusionPattern = { kind: "regex", value: "^cache/$" };
    expect(patternRegex(p)).toBe("^cache/$");
    expect(matches(p, "cache/")).toBe(true);
  });

  it("refuse a pattern with nothing to match, or a regex that is wrong", () => {
    expect(patternError({ kind: "name", value: "*" })).not.toBeNull();
    expect(patternError({ kind: "name", value: " / " })).not.toBeNull();
    expect(patternError({ kind: "regex", value: "(" })).not.toBeNull();
    expect(patternError({ kind: "name", value: "(" })).toBeNull();
    expect(patternError({ kind: "contains", value: "[" })).toBeNull();
  });
});
