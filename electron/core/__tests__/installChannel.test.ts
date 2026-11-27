import { describe, expect, it } from "vitest";
import { installChannel, type InstallEnv } from "../installChannel.js";

const base: InstallEnv = {
  isPackaged: true,
  platform: "linux",
  windowsStore: false,
  execPath: "/tmp/.mount_x/meguri",
  env: {},
};

describe("installChannel", () => {
  it.each<[Partial<InstallEnv>, string]>([
    [{ isPackaged: false }, "Built from source"],
    [{ platform: "win32", windowsStore: true }, "Microsoft Store"],
    [
      { platform: "win32", env: { PORTABLE_EXECUTABLE_DIR: "C:\\x" } },
      "GitHub Release (portable)",
    ],
    [{ platform: "win32" }, "GitHub Release (installer)"],
    [{ platform: "darwin" }, "GitHub Release"],
    [
      { env: { APPIMAGE: "/home/u/Meguri.AppImage" } },
      "GitHub Release (AppImage)",
    ],
    [{ execPath: "/opt/meguri-bin/meguri" }, "AUR (meguri-bin)"],
    [{ execPath: "/opt/Meguri/meguri" }, "GitHub Release (deb)"],
    [{ execPath: "/usr/lib/meguri/meguri" }, "Other"],
  ])("%o → %s", (overrides, expected) => {
    expect(installChannel({ ...base, ...overrides })).toBe(expected);
  });
});
