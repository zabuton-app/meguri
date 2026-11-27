// Web permissions the window may use. Electron grants every request by
// default (camera, microphone, notifications, clipboard read, HID, serial…),
// so a compromised renderer would get them all; only what the app uses is
// allowed (#273).
import type { Session } from "electron";
import { scopedLog } from "./logger.js";

const log = scopedLog("permissions");

const ALLOWED: ReadonlySet<string> = new Set([
  // The detail view's "copy frame" writes an image with navigator.clipboard.
  "clipboard-sanitized-write",
  // The players' fullscreen button (Element.requestFullscreen).
  "fullscreen",
]);

function isPermissionAllowed(permission: string): boolean {
  return ALLOWED.has(permission);
}

/** Deny every permission and device request but the ones the app uses. */
export function restrictPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = isPermissionAllowed(permission);
    // Logged so a feature that starts needing a new permission shows up as
    // a denial rather than silently doing nothing.
    if (!allowed) log.info(`denied permission request: ${permission}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    isPermissionAllowed(permission),
  );
  // HID, serial and USB devices: the app uses none.
  ses.setDevicePermissionHandler(() => false);
}
