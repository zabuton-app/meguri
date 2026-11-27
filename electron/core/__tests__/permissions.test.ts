// Only the permissions the app uses are granted (#273).
import { describe, expect, it } from "vitest";
import type { Session } from "electron";
import { restrictPermissions } from "../permissions.js";

type RequestHandler = (
  wc: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;
type CheckHandler = (wc: unknown, permission: string) => boolean;

function fakeSession() {
  const h: {
    request?: RequestHandler;
    check?: CheckHandler;
    device?: () => boolean;
  } = {};
  const ses = {
    setPermissionRequestHandler: (fn: RequestHandler) => (h.request = fn),
    setPermissionCheckHandler: (fn: CheckHandler) => (h.check = fn),
    setDevicePermissionHandler: (fn: () => boolean) => (h.device = fn),
  } as unknown as Session;
  restrictPermissions(ses);
  const request = (permission: string) => {
    let granted: boolean | undefined;
    h.request?.(null, permission, (g) => (granted = g));
    return granted;
  };
  return {
    request,
    check: (p: string) => h.check?.(null, p),
    device: h.device,
  };
}

describe("restrictPermissions", () => {
  it("grants what the app uses", () => {
    const s = fakeSession();
    for (const p of ["clipboard-sanitized-write", "fullscreen"]) {
      expect(s.request(p)).toBe(true);
      expect(s.check(p)).toBe(true);
    }
  });

  it("denies everything else", () => {
    const s = fakeSession();
    for (const p of [
      "media",
      "notifications",
      "clipboard-read",
      "geolocation",
      "hid",
      "serial",
      "openExternal",
      "unknown",
    ]) {
      expect(s.request(p)).toBe(false);
      expect(s.check(p)).toBe(false);
    }
    expect(s.device?.()).toBe(false);
  });
});
