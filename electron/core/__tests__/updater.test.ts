import { describe, expect, it } from "vitest";
import { compareVersions } from "../updater.js";

describe("compareVersions", () => {
  it("treats equal versions as 0", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("detects a newer version", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  });

  it("detects an older version", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.3.0")).toBeLessThan(0);
  });

  it("ignores a leading v and is case-insensitive", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("V1.0.0", "v1.0.0")).toBe(0);
  });

  it("treats missing components as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBeLessThan(0);
  });

  it("drops a pre-release suffix and compares the core", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.1.0-rc1", "1.0.0")).toBeGreaterThan(0);
  });

  it("tolerates non-numeric garbage by treating it as 0", () => {
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
  });
});
