import { describe, expect, it } from "vitest";
import { needsWaylandVideoWorkaround } from "../waylandVideoWorkaround.js";

describe("needsWaylandVideoWorkaround", () => {
  it("applies on Linux under Wayland", () => {
    expect(needsWaylandVideoWorkaround("linux", "wayland")).toBe(true);
  });

  it("leaves X11 alone, which the e2e run and XWayland use", () => {
    expect(needsWaylandVideoWorkaround("linux", "x11")).toBe(false);
    expect(needsWaylandVideoWorkaround("linux", "")).toBe(false);
  });

  it("does not apply on other platforms", () => {
    expect(needsWaylandVideoWorkaround("darwin", "")).toBe(false);
    expect(needsWaylandVideoWorkaround("win32", "wayland")).toBe(false);
  });
});
