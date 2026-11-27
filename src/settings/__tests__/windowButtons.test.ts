import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => vi.fn(() => "linux"));
vi.mock("@/lib/platform", () => ({ platform: () => platform() }));

const { defaultWindowButtons } = await import("@/settings/PreferencesProvider");

describe("defaultWindowButtons", () => {
  it("follows the OS: left on macOS, right elsewhere", () => {
    platform.mockReturnValue("darwin");
    expect(defaultWindowButtons()).toBe("left");
    for (const os of ["win32", "linux", ""]) {
      platform.mockReturnValue(os);
      expect(defaultWindowButtons()).toBe("right");
    }
  });
});
